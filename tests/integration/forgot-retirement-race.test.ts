import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { db } from "../../src/lib/db";

test("a forgot-password request cannot issue a token after deactivation", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID(), org = await db.organisation.create({ data: { name: "Reset race", slug: key } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Test", email: `${key}@example.invalid`, passwordHash: "synthetic" } });
  let ready!: () => void, resume!: () => void, sends = 0;
  const observed = new Promise<void>(resolve => { ready = resolve; }), proceed = new Promise<void>(resolve => { resume = resolve; });
  const fixture = new Proxy(db, { get(target, key, receiver) {
    if (key === "user") return new Proxy(target.user, { get(delegate, field, inner) {
      if (field === "findFirst") return async (...args: Parameters<typeof delegate.findFirst>) => { const value = await delegate.findFirst(...args); ready(); await proceed; return value; };
      return Reflect.get(delegate, field, inner);
    } });
    const value = Reflect.get(target, key, receiver); return typeof value === "function" ? value.bind(target) : value;
  } });
  const out = await build({ entryPoints: ["src/app/api/auth/forgot-password/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|email|request-security)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : a.path.endsWith("/email") ? "export const emailProvider=()=>({send:async()=>__send()});" : "export const sameOrigin=()=>true; export const rateLimit=async()=>false; export const requestIp=()=>''; export const privacyHash=()=>''; export const dlpRecipientHash=()=>'';", resolveDir: process.cwd() }));
  } }] });
  const mod = { exports: {} as { POST: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__send", out.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports, fixture, () => { sends++; });
  try {
    const request = new Request("https://example.invalid/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email }) });
    const pending = mod.exports.POST(request);
    await observed;
    try { await db.user.update({ where: { id: user.id }, data: { active: false } }); } finally { resume(); }
    assert.equal((await pending).status, 200); assert.equal(sends, 0);
    assert.equal(await db.passwordResetToken.count({ where: { userId: user.id } }), 0);
    await assert.rejects(db.passwordResetToken.create({ data: { userId: user.id, organisationId: org.id, tokenHash: key, expiresAt: new Date(Date.now() + 60000) } }));
  } finally { await db.$disconnect(); }
});
