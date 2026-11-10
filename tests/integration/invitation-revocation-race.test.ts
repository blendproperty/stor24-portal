import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { db } from "../../src/lib/db";
import { hashInvitationToken } from "../../src/lib/invitation-service";

test("invitation revocation cannot overwrite a concurrent acceptance", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Invitation race CI", slug: key } });
  const owner = await db.user.create({ data: { organisationId: org.id, name: "Owner", email: `owner-${key}@example.invalid`, passwordHash: "synthetic" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
  await db.roleAssignment.create({ data: { userId: owner.id, roleId: role.id } });
  const token = randomUUID();
  const invite = await db.userInvitation.create({ data: { organisationId: org.id, name: "Employee", email: `invite-${key}@example.invalid`, roleName: "Organisation owner", invitedByName: "Synthetic owner", tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + 60000) } });
  let captured!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { captured = r; }), resume = new Promise<void>(r => { release = r; });
  const wrapped = { user: db.user, userInvitation: { findFirst: async (args: Parameters<typeof db.userInvitation.findFirst>[0]) => { const found = await db.userInvitation.findFirst(args); captured(); await resume; return found; } }, $transaction: db.$transaction.bind(db) };
  const output = await build({ entryPoints: ["src/app/api/v1/invitations/[id]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|session)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
  } }] });
  const mod = { exports: {} as { DELETE: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__session", output.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports, wrapped, { userId: owner.id, sessionVersion: owner.sessionVersion, mfaVerified: true });
  try {
    const request = new Request("https://example.invalid/api", { method: "DELETE", headers: { origin: "https://example.invalid" } });
    const revocation = mod.exports.DELETE(request, { params: Promise.resolve({ id: invite.id }) });
    await ready;
    await db.userInvitation.update({ where: { id: invite.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    release();
    assert.equal((await revocation).status, 409);
    assert.equal((await db.userInvitation.findUniqueOrThrow({ where: { id: invite.id } })).status, "ACCEPTED");
    assert.equal(await db.auditEvent.count({ where: { entityId: invite.id, action: "user.invitation.revoked" } }), 0);
    const pending = await db.userInvitation.create({ data: { organisationId: org.id, name: "Other employee", email: `other-${key}@example.invalid`, roleName: "Organisation owner", invitedByName: "Synthetic owner", tokenHash: hashInvitationToken(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
    const revoke = () => mod.exports.DELETE(new Request("https://example.invalid/api", { method: "DELETE", headers: { origin: "https://example.invalid" } }), { params: Promise.resolve({ id: pending.id }) });
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_invitation_revoke_audit_failure CHECK (false) NOT VALID');
    try { assert.equal((await revoke()).status, 500); assert.equal((await db.userInvitation.findUniqueOrThrow({ where: { id: pending.id } })).status, "PENDING"); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_invitation_revoke_audit_failure'); }
    assert.equal((await revoke()).status, 200);
    assert.equal((await db.userInvitation.findUniqueOrThrow({ where: { id: pending.id } })).status, "REVOKED");
    assert.equal((await revoke()).status, 409);
  } finally { release(); await db.$disconnect(); }
});
