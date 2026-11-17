import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { db } from "../../src/lib/db";

test("owner can review and safely reassign an outstanding task", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Transfer test", slug: key } });
  const other = await db.organisation.create({ data: { name: "Foreign test", slug: `${key}-other` } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Store", code: `S-${key}` } });
  const makeUser = (organisationId: string, name: string) => db.user.create({ data: { organisationId, name, email: `${name}-${key}@example.invalid`, passwordHash: "synthetic" } });
  const owner = await makeUser(org.id, "owner"), target = await makeUser(org.id, "target"), recipient = await makeUser(org.id, "recipient"), foreign = await makeUser(other.id, "foreign"), unprivileged = await makeUser(org.id, "unprivileged");
  const ownerRole = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
  const staffRole = await db.role.create({ data: { organisationId: org.id, name: "Staff", permissions: ["operations.view"] } });
  await db.roleAssignment.create({ data: { userId: owner.id, roleId: ownerRole.id } });
  await db.roleAssignment.create({ data: { userId: recipient.id, roleId: staffRole.id, facilityId: facility.id } });
  const task = await db.task.create({ data: { organisationId: org.id, facilityId: facility.id, title: "Outstanding", purpose: "GENERAL", assigneeId: target.id, createdById: target.id, coverAcknowledgedAt: new Date() } });
  const restricted = await db.task.create({ data: { organisationId: org.id, facilityId: facility.id, title: "Checklist", purpose: "OPERATIONAL_CHECKLIST", assigneeId: target.id } });
  const covered = await db.task.create({ data: { organisationId: org.id, facilityId: facility.id, title: "Follow-up", purpose: "AGREED_FOLLOWUP", assigneeId: owner.id, coverId: target.id, coverAcknowledgedAt: new Date() } });
  let session: unknown = { userId: owner.id, sessionVersion: owner.sessionVersion, mfaVerified: true };
  const out = await build({ entryPoints: ["src/app/api/v1/users/[id]/work/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|session)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session();", resolveDir: process.cwd() }));
  } }] });
  const mod = { exports: {} as { GET: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>; POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__session", out.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports, db, () => session);
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (id: string, taskId: string, replacementId: string, updatedAt: string, origin = "https://example.invalid") => mod.exports.POST(new Request("https://example.invalid/api", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ taskId, replacementId, updatedAt }) }), context(id));
  try {
    session = null;
    assert.equal((await mod.exports.GET(new Request("https://example.invalid/api"), context(target.id))).status, 401);
    session = { userId: owner.id, sessionVersion: owner.sessionVersion, mfaVerified: true };
    const preview = await mod.exports.GET(new Request("https://example.invalid/api"), context(target.id));
    assert.equal(preview.status, 200); assert.equal((await preview.json()).data.length, 3);
    assert.equal((await mod.exports.GET(new Request("https://example.invalid/api"), context(foreign.id))).status, 404);
    session = { userId: unprivileged.id, sessionVersion: unprivileged.sessionVersion, mfaVerified: true };
    assert.equal((await post(target.id, task.id, recipient.id, task.updatedAt.toISOString())).status, 403);
    session = { userId: owner.id, sessionVersion: owner.sessionVersion, mfaVerified: true };
    assert.equal((await post(target.id, task.id, recipient.id, task.updatedAt.toISOString(), "https://attacker.invalid")).status, 403);
    assert.equal((await post(target.id, task.id, foreign.id, task.updatedAt.toISOString())).status, 409);
    assert.equal((await post(target.id, task.id, unprivileged.id, task.updatedAt.toISOString())).status, 409);
    assert.equal((await post(target.id, restricted.id, recipient.id, restricted.updatedAt.toISOString())).status, 409);
    assert.equal((await post(target.id, task.id, recipient.id, new Date(0).toISOString())).status, 409);
    assert.equal((await post(target.id, covered.id, owner.id, covered.updatedAt.toISOString())).status, 409);
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_work_transfer_failure CHECK (false) NOT VALID');
    try { assert.equal((await post(target.id, task.id, recipient.id, task.updatedAt.toISOString())).status, 500); assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, target.id); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_work_transfer_failure'); }
    assert.equal((await post(target.id, task.id, recipient.id, task.updatedAt.toISOString())).status, 200);
    const saved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(saved.assigneeId, recipient.id); assert.equal(saved.createdById, target.id); assert.equal(saved.coverAcknowledgedAt, null);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: task.id, action: "staff.task_reassigned" } });
    assert.equal(audit.actorId, owner.id); assert.deepEqual(audit.before, { assigneeId: target.id, coverId: null }); assert.deepEqual(audit.after, { assigneeId: recipient.id, coverId: null });
    assert.equal((await post(target.id, task.id, recipient.id, task.updatedAt.toISOString())).status, 409);
    assert.equal((await post(target.id, covered.id, recipient.id, covered.updatedAt.toISOString())).status, 200);
    const savedCover = await db.task.findUniqueOrThrow({ where: { id: covered.id } });
    assert.equal(savedCover.coverId, recipient.id); assert.equal(savedCover.coverAcknowledgedAt, null);
    const race = await db.task.create({ data: { organisationId: org.id, facilityId: facility.id, title: "Race", assigneeId: target.id } });
    const concurrent = await Promise.all([post(target.id, race.id, recipient.id, race.updatedAt.toISOString()), post(target.id, race.id, recipient.id, race.updatedAt.toISOString())]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
    assert.equal(await db.auditEvent.count({ where: { entityId: race.id, action: "staff.task_reassigned" } }), 1);
  } finally { await db.$disconnect(); }
});
