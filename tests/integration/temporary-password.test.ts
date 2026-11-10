import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { hash } from "bcryptjs";
import { db } from "../../src/lib/db";
import { mfaLoginFixture } from "../helpers/mfa-login-fixture";
import { mfaRequest } from "../helpers/mfa-routes-fixture";

 test("temporary credential is single use and grants no staff session", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Temporary password CI", slug: key } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Test", email: `${key}@example.invalid`, passwordHash: await hash("Old-Synthetic-Password-2026!", 4) } });
  const actor = await db.user.create({ data: { organisationId: org.id, name: "Owner", email: `owner-${key}@example.invalid` } });
  const output = await build({ entryPoints: ["src/app/api/v1/users/[id]/temporary-password/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const requireOwner=async()=>__actor;export const authErrorResponse=()=>new Response(null,{status:403});" }));
  } }] });
  const mod = { exports: {} as { POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__actor", output.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports, db, { user: actor });
  try {
    assert.equal((await mod.exports.POST(mfaRequest({}), { params: Promise.resolve({ id: actor.id }) })).status, 409);
    assert.equal((await mod.exports.POST(mfaRequest({}), { params: Promise.resolve({ id: "missing" }) })).status, 404);
    const create = await mod.exports.POST(mfaRequest({}), { params: Promise.resolve({ id: user.id }) });
    assert.equal(create.status, 200); assert.equal(create.headers.get("cache-control"), "no-store");
    const token = (await create.json()).data.temporaryPassword as string;
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.passwordHash, null); assert.equal(after.sessionVersion, user.sessionVersion + 1);
    const routes = await mfaLoginFixture(db);
    assert.equal((await routes.login(mfaRequest({ email: actor.email, password: token }))).status, 401);
    const login = await routes.login(mfaRequest({ email: user.email, password: token }));
    assert.equal((await login.json()).data.passwordChangeRequired, true); assert.equal(routes.sessions.length, 0);
    assert.equal((await routes.resetPassword(mfaRequest({ token, password: token }))).status, 422);
    assert.equal((await routes.resetPassword(mfaRequest({ token, password: "New-Synthetic-Password-2026!" }))).status, 200);
    assert.equal((await routes.resetPassword(mfaRequest({ token, password: "Another-Synthetic-Password-2026!" }))).status, 410);
    assert.equal((await routes.login(mfaRequest({ email: user.email, password: token }))).status, 401);
    assert.equal((await routes.login(mfaRequest({ email: user.email, password: "Old-Synthetic-Password-2026!" }))).status, 401);
    assert.equal((await routes.login(mfaRequest({ email: user.email, password: "New-Synthetic-Password-2026!" }))).status, 200);
    assert.equal(routes.sessions[0].sessionVersion, user.sessionVersion + 2);
    const second = await mod.exports.POST(mfaRequest({}), { params: Promise.resolve({ id: user.id }) });
    const expired = (await second.json()).data.temporaryPassword as string;
    await db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { expiresAt: new Date(0) } });
    assert.equal((await routes.login(mfaRequest({ email: user.email, password: expired }))).status, 401);
    assert.equal((await routes.resetPassword(mfaRequest({ token: expired, password: "New-Synthetic-Password-2026!" }))).status, 410);
  } finally { await db.$disconnect(); }
});
