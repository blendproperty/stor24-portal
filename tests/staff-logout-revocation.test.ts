import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture(concurrentReads = false) {
  let user = { id: "synthetic", organisationId: "org", active: true, sessionVersion: 1, roleAssignments: [] };
  const values = new Map<string, string>();
  const jar = { get: (name: string) => values.has(name) ? { value: values.get(name) } : undefined, set: (name: string, value: string) => { values.set(name, value); }, delete: (name: string) => { values.delete(name); } };
  let audits = 0, failAudit = false, reads = 0, revokeBeforeTransaction = false;
  let releaseReads!: () => void;
  const bothRead = new Promise<void>(resolve => { releaseReads = resolve; });
  const database = {
    user: {
      findUnique: async () => {
        const snapshot = structuredClone(user);
        if (concurrentReads && ++reads <= 2) { if (reads === 2) releaseReads(); await bothRead; }
        return snapshot;
      },
      updateMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (!Object.entries(where).every(([key, value]) => user[key as keyof typeof user] === value)) return { count: 0 };
        user.sessionVersion++; return { count: 1 };
      },
    },
    auditEvent: { create: async () => { if (failAudit) throw new Error("SYNTHETIC_AUDIT_FAILURE"); audits++; } },
  };
  const db = { ...database, $transaction: async <T>(operation: (tx: typeof database) => Promise<T>) => {
    if (revokeBeforeTransaction) { user.sessionVersion++; revokeBeforeTransaction = false; }
    const snapshot = structuredClone(user), count = audits;
    try { return await operation(database); } catch (error) { user = snapshot; audits = count; throw error; }
  } };
  const output = await build({ stdin: { contents: 'export {POST as logout} from "./src/app/api/auth/logout/route";export {requireSession} from "./src/lib/auth-guards";export {createSessionToken} from "./src/lib/session";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "logout-isolation", setup(b) {
    b.onResolve({ filter: /^(next\/headers|@\/lib\/db)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path === "next/headers" ? "export const cookies=async()=>__jar;" : "export const db=__db;" }));
  } }] });
  const loaded = { exports: {} as { logout: (request: Request) => Promise<Response>; requireSession: () => Promise<unknown>; createSessionToken: (claims: unknown) => Promise<string> } };
  new Function("require", "module", "exports", "__db", "__jar", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, jar);
  const token = await loaded.exports.createSessionToken({ userId: user.id, name: "Synthetic", email: "staff@example.invalid", role: "Unassigned", sessionVersion: 1, mfaVerified: true });
  jar.set("stor24_session", token); jar.set("stor24_mfa_challenge", "synthetic-pending-challenge");
  return { ...loaded.exports, values, jar, token, user: () => user, audits: () => audits, failAudit: () => { failAudit = true; }, revokeBeforeTransaction: () => { revokeBeforeTransaction = true; } };
}
const request = (origin = "http://localhost") => new Request("http://localhost/api/auth/logout", { method: "POST", headers: { origin } });

test("staff logout revokes copied cookies on every device and removes pending MFA", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-logout-boundary-key-01234567890123456789";
  try {
    const f = await fixture();
    await f.requireSession();
    assert.equal((await f.logout(request())).status, 200);
    assert.equal(f.user().sessionVersion, 2); assert.equal(f.audits(), 1); assert.equal(f.values.size, 0);
    f.jar.set("stor24_session", f.token);
    await assert.rejects(f.requireSession(), /UNAUTHENTICATED/);
    assert.equal((await f.logout(request())).status, 401);
    assert.equal(f.user().sessionVersion, 2); assert.equal(f.audits(), 1);
    const current = await f.createSessionToken({ userId: "synthetic", name: "Synthetic", email: "staff@example.invalid", role: "Unassigned", sessionVersion: 2, mfaVerified: true });
    f.jar.set("stor24_session", current); await f.requireSession();
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});

test("logout rejects foreign origins and fails visibly without a committed revocation", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-logout-boundary-key-01234567890123456789";
  try {
    const f = await fixture();
    assert.equal((await f.logout(request("https://foreign.invalid"))).status, 403);
    assert.equal(f.user().sessionVersion, 1); assert.equal(f.audits(), 0); assert.equal(f.values.size, 2);
    f.failAudit();
    assert.equal((await f.logout(request())).status, 500);
    assert.equal(f.user().sessionVersion, 1); assert.equal(f.values.size, 2);
    await f.requireSession();
    const concurrent = await fixture(true);
    const responses = await Promise.all([concurrent.logout(request()), concurrent.logout(request())]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    assert.equal(concurrent.user().sessionVersion, 2); assert.equal(concurrent.audits(), 1);
    const stale = await fixture(); stale.revokeBeforeTransaction();
    assert.equal((await stale.logout(request())).status, 200);
    assert.equal(stale.user().sessionVersion, 2); assert.equal(stale.audits(), 0); assert.equal(stale.values.size, 0);
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
