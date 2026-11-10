import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { hash } from "bcryptjs";
import { db } from "../../src/lib/db";
import { hashResetToken } from "../../src/lib/password-reset";
import { mfaRequest } from "../helpers/mfa-routes-fixture";

 test("temporary reset enforces owner, scope and atomicity", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Reset security CI", slug: key } });
  const other = await db.organisation.create({ data: { name: "Other organisation", slug: `${key}-other` } });
  const owner = await db.user.create({ data: { organisationId: org.id, name: "Owner", email: `owner-${key}@example.invalid`, passwordHash: await hash("Owner-Synthetic-Password-2026!", 4) } });
  const employee = await db.user.create({ data: { organisationId: org.id, name: "Employee", email: `employee-${key}@example.invalid`, passwordHash: await hash("Staff-Synthetic-Password-2026!", 4) } });
  const foreign = await db.user.create({ data: { organisationId: other.id, name: "Foreign", email: `foreign-${key}@example.invalid`, passwordHash: "synthetic" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
  const staffRole = await db.role.create({ data: { organisationId: org.id, name: "Staff", permissions: ["users.manage"] } });
  await db.roleAssignment.create({ data: { userId: owner.id, roleId: role.id } });
  await db.roleAssignment.create({ data: { userId: employee.id, roleId: staffRole.id } });
  let session: unknown = null;
  const output = await build({ entryPoints: ["src/app/api/v1/users/[id]/temporary-password/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|session)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session();" }));
  } }] });
  const mod = { exports: {} as { POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__session", output.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports, db, () => session);
  const call = (id: string, request = mfaRequest({})) => mod.exports.POST(request, { params: Promise.resolve({ id }) });
  try {
    await t.test("requires same origin, current authenticated MFA owner, and organisation scope", async () => {
      assert.equal((await call(employee.id)).status, 401);
      session = { userId: employee.id, sessionVersion: employee.sessionVersion, mfaVerified: true };
      assert.equal((await call(owner.id)).status, 403);
      session = { userId: owner.id, sessionVersion: owner.sessionVersion, mfaVerified: false };
      assert.equal((await call(employee.id)).status, 403);
      session = { userId: owner.id, sessionVersion: owner.sessionVersion + 1, mfaVerified: true };
      assert.equal((await call(employee.id)).status, 401);
      session = { userId: owner.id, sessionVersion: owner.sessionVersion, mfaVerified: true };
      assert.equal((await call(employee.id, new Request("https://example.invalid/api", { method: "POST", headers: { origin: "https://attacker.invalid" } }))).status, 403);
      assert.equal((await call(foreign.id)).status, 404);
      assert.equal((await call(owner.id)).status, 409);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: foreign.id } })).sessionVersion, foreign.sessionVersion);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).passwordHash, employee.passwordHash);
    });
    await t.test("removing and restoring an employee preserves history and revokes sessions and reset links", async () => {
      const target = await db.user.create({ data: { organisationId: org.id, name: "Remove test", email: `remove-${key}@example.invalid`, passwordHash: "synthetic" } });
      const reset = await db.passwordResetToken.create({ data: { userId: target.id, organisationId: org.id, tokenHash: hashResetToken(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
      const bundle = await build({ entryPoints: ["src/app/api/v1/users/[id]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture", setup(b) {
        b.onResolve({ filter: /^@\/lib\/(db|session)$/ }, a => ({ path: a.path, namespace: "fixture" }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session();" }));
      } }] });
      const loaded = { exports: {} as { PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, () => session);
      const change = (active: boolean) => loaded.exports.PATCH(new Request("https://example.invalid/api", { method: "PATCH", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify({ active }) }), { params: Promise.resolve({ id: target.id }) });
      assert.equal((await change(false)).status, 200);
      const removed = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(removed.active, false); assert.equal(removed.sessionVersion, target.sessionVersion + 1); assert.ok((await db.passwordResetToken.findUniqueOrThrow({ where: { id: reset.id } })).usedAt);
      assert.equal((await change(true)).status, 200);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).active, true);
      assert.equal(await db.auditEvent.count({ where: { entityId: target.id, action: "user.access.updated" } }), 2);
    });
    await t.test("audit failure rolls back password, session version and existing reset token", async () => {
      const token = await db.passwordResetToken.create({ data: { userId: employee.id, organisationId: org.id, tokenHash: hashResetToken(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_temporary_password_audit_failure CHECK (false) NOT VALID');
      try {
        assert.equal((await call(employee.id)).status, 500);
        const current = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
        assert.equal(current.passwordHash, employee.passwordHash); assert.equal(current.sessionVersion, employee.sessionVersion);
        assert.equal((await db.passwordResetToken.findUniqueOrThrow({ where: { id: token.id } })).usedAt, null);
        assert.equal(await db.passwordResetToken.count({ where: { userId: employee.id } }), 1);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_temporary_password_audit_failure'); }
    });
    await t.test("concurrent issuance leaves only the successful credential active", async () => {
      const responses = await Promise.all([call(employee.id), call(employee.id)]);
      assert.ok(responses.some(r => r.status === 200));
      assert.ok(responses.every(r => [200, 409].includes(r.status)));
      const active = await db.passwordResetToken.findMany({ where: { userId: employee.id, usedAt: null } });
      assert.equal(active.length, 1);
      const current = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
      assert.equal(current.passwordHash, null);
      assert.equal(await db.auditEvent.count({ where: { entityId: employee.id, action: "user.temporary_password.created" } }), responses.filter(r => r.status === 200).length);
    });
  } finally { await db.$disconnect(); }
});
