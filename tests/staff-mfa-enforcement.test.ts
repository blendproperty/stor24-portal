import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { hash } from "bcryptjs";
import { mfaLoginFixture } from "./helpers/mfa-login-fixture";
import { mfaRequest, mfaRoutesFixture } from "./helpers/mfa-routes-fixture";
import { createInvitationSchema, updateUserSchema } from "../src/lib/validators";
import { hasPermission } from "../src/lib/permissions";

test("password-only and historical cookies cannot access staff pages or API guards, including owners", async () => {
  const state = { session: { userId: "staff", sessionVersion: 0, mfaVerified: false }, user: { id: "staff", active: true, sessionVersion: 0, mfaCredential: null as null | { enabledAt: Date }, roleAssignments: [{ facilityId: null, role: { name: "Organisation owner", permissions: ["*"] } }] } };
  const result = await build({ stdin: { contents: 'export {proxy} from "./src/proxy";export {requireSession,requireOwner} from "./src/lib/auth-guards";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "enforcement", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|session)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db={user:{findUnique:async()=>__state.user}};" : "export const sessionCookieName='stor24_session';export const getSession=async()=>__state.session;export const verifySessionToken=async()=>__state.session;" }));
  } }] });
  const loaded = { exports: {} as { proxy: (r: NextRequest) => Promise<Response>; requireSession: (options?: { allowMfaSetup?: boolean }) => Promise<unknown>; requireOwner: () => Promise<unknown> } };
  new Function("require", "module", "exports", "__state", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const f = loaded.exports, visit = (path: string) => f.proxy(new NextRequest("https://portal.example.invalid" + path));
  await assert.rejects(f.requireSession(), /MFA_REQUIRED/);
  await assert.rejects(f.requireOwner(), /MFA_REQUIRED/);
  await f.requireSession({ allowMfaSetup: true });
  assert.equal(new URL((await visit("/operations")).headers.get("location")!).pathname, "/mfa-setup");
  for (const path of ["/api/v1/users", "/api/auth/mfa/extra", "/api/auth/logout/extra"]) assert.equal((await visit(path)).status, 403);
  for (const path of ["/mfa-setup", "/api/auth/mfa", "/api/auth/logout", "/login"]) assert.equal((await visit(path)).headers.get("x-middleware-next"), "1");
  state.user.mfaCredential = { enabledAt: new Date() };
  assert.equal(new URL((await visit("/operations")).headers.get("location")!).pathname, "/login");
  assert.equal((await visit("/login")).headers.get("x-middleware-next"), "1", "no login redirect loop for old cookies");
  state.session.mfaVerified = true;
  await f.requireOwner();
  assert.equal((await visit("/operations")).headers.get("x-middleware-next"), "1");
  state.user.sessionVersion++;
  await assert.rejects(f.requireSession(), /UNAUTHENTICATED/);
  assert.equal((await visit("/api/v1/users")).status, 401);
});

test("password login without an authenticator creates only a setup session; disable is refused", async () => {
  const user = { id: "staff", name: "Synthetic", email: "staff@example.invalid", organisationId: "org", active: true, sessionVersion: 0, roleAssignments: [], mfaCredential: null, passwordHash: await hash("Synthetic-password!", 4) };
  const db = { user: { findFirst: async () => user, findUnique: async () => user }, auditEvent: { create: async () => ({}) } };
  const f = await mfaLoginFixture(db);
  const response = await f.login(mfaRequest({ email: user.email, password: "Synthetic-password!" }));
  assert.equal((await response.json()).data.mfaSetupRequired, true);
  assert.equal((f.sessions[0] as { mfaVerified?: boolean }).mfaVerified, false);
  const manage = await mfaRoutesFixture(db, { getSession: async () => ({ userId: user.id, sessionVersion: 0 }), setSession: async () => { throw Error("NO_SESSION_ON_DENIED_DISABLE"); }, getChallenge: async () => null, clearChallenge: async () => {} });
  assert.equal((await manage.manage(mfaRequest({ action: "disable" }))).status, 403);
});

test("Customer service operator is valid and its seeded permissions exclude approvals and financial posting", async () => {
  assert.equal(createInvitationSchema.safeParse({ name: "Synthetic Operator", email: "operator@example.invalid", roleName: "Customer service operator", facilityCode: "MIDPOINT" }).success, true);
  assert.equal(updateUserSchema.safeParse({ roleName: "Customer service operator" }).success, true);
  const roles: { name: string; permissions: string[] }[] = [];
  const result = await build({ entryPoints: ["src/lib/invitation-service.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "roles", setup(b) {
    b.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const db=__db;" }));
  } }] });
  const db = { organisation: { upsert: async () => ({ id: "org" }) }, facility: { upsert: async () => ({}) }, role: { upsert: async ({ create }: { create: typeof roles[number] }) => { roles.push(create); return create; } } };
  const loaded = { exports: {} as { ensureStor24Workspace: () => Promise<unknown> } };
  new Function("require", "module", "exports", "__db", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db);
  await loaded.exports.ensureStor24Workspace();
  const role = roles.find(r => r.name === "Customer service operator")!;
  assert.ok(role);
  for (const permission of ["operations.view", "operations.manage", "reservations.manage", "reservation_prices.view", "reservation_prices.propose", "customer_history.export"]) assert.equal(hasPermission(role.permissions, permission), true, permission);
  for (const permission of ["reservation_prices.approve", "payments.manage", "payments.refund_prepare", "ledger.manage", "adjustments.approve", "users.manage", "access.suspend", "data.personal_export"]) assert.equal(hasPermission(role.permissions, permission), false, permission);
});

test("enrolment verifies TOTP, revokes other password sessions and issues a verified session only on success", async t => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-required-mfa-enrolment-test-key-20261020";
  t.after(() => { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; });
  let version = 0;
  let credential: { enabledAt: Date | null; secretEncrypted: string; recoveryCodeHashes: string[] } | null = null;
  const issued: { sessionVersion: number; mfaVerified?: boolean }[] = [];
  const user = () => ({ id: "staff", organisationId: "org", name: "Synthetic", email: "staff@example.invalid", active: true, sessionVersion: version, roleAssignments: [] });
  const tx = {
    $queryRaw: async () => [{ id: "staff" }],
    user: { findUnique: async () => user(), update: async () => { version++; return user(); } },
    mfaCredential: {
      findUnique: async () => credential,
      upsert: async ({ create }: { create: NonNullable<typeof credential> }) => { credential = create; return credential; },
      update: async ({ data }: { data: Partial<NonNullable<typeof credential>> }) => { credential = { ...credential!, ...data }; return credential; },
    },
    auditEvent: { create: async () => ({}) },
  };
  const f = await mfaRoutesFixture({ ...tx, $transaction: async <T>(op: (db: typeof tx) => Promise<T>) => op(tx) }, { getSession: async () => ({ userId: "staff", sessionVersion: 0, mfaVerified: false }), setSession: async value => { issued.push(value as typeof issued[number]); }, getChallenge: async () => null, clearChallenge: async () => {} });
  const setup = await f.manage(mfaRequest({ action: "begin" }));
  const secret = (await setup.json()).data.secret;
  assert.equal((await f.manage(mfaRequest({ action: "enable", code: "invalid" }))).status, 422);
  assert.equal(version, 0); assert.equal(issued.length, 0);
  const enabled = await f.manage(mfaRequest({ action: "enable", code: f.totpCode(secret) }));
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).data.recoveryCodes.length > 0, true);
  assert.equal(version, 1);
  assert.equal(issued[0].sessionVersion, 1); assert.equal(issued[0].mfaVerified, true);
  assert.equal((await f.manage(mfaRequest({ action: "begin" }))).status, 401, "old password cookie is revoked");
});
