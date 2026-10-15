import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { createStaffFollowup, changeStaffFollowup, listStaffFollowups } from "../../src/lib/staff-followup-service";

test("isolated customer appointments: retries, cover acknowledgements, store boundaries and atomic audit", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const org = await db.organisation.create({ data: { name: "Synthetic follow-ups", slug: randomUUID() } });
  const a = await db.facility.create({ data: { organisationId: org.id, name: "Midpoint fixture", code: "A" } });
  const b = await db.facility.create({ data: { organisationId: org.id, name: "Other store fixture", code: "B" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Synthetic operator", permissions: ["operations.view", "operations.manage"] } });
  const staff = await db.user.create({ data: { organisationId: org.id, name: "Responsible fixture", email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: a.id } } } });
  const cover = await db.user.create({ data: { organisationId: org.id, name: "Cover fixture", email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: a.id } } } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic appointment" } });
  await db.lead.create({ data: { facilityId: a.id, customerId: customer.id, source: "OTHER" } });
  const scope = { organisationId: org.id, userId: staff.id, facilityIds: [a.id], unrestrictedFacilities: false };
  const input = () => ({ requestKey: randomUUID(), customerId: customer.id, facilityId: a.id, assigneeId: staff.id, coverId: cover.id, title: "Agreed call on 14th", description: "Call agreed for 14 October, payment promised 15 October. Do not remove debt-contact hold.", dueAt: "2026-10-14T07:00:00.000Z" });
  try {
    await t.test("concurrent retry creates exactly one customer-linked appointment and audit", async () => {
      const command = input();
      const [first, retry] = await Promise.all([createStaffFollowup(scope, command), createStaffFollowup(scope, command)]);
      assert.equal(first.id, retry.id);
      assert.equal(await db.auditEvent.count({ where: { entityId: first.id } }), 1);
      assert.equal(first.customerId, customer.id);
      assert.equal(first.coverAcknowledgedAt, null);
      await assert.rejects(createStaffFollowup(scope, { ...command, title: "Changed title" }), /CONFLICT/);
    });
    await t.test("only assigned cover acknowledges; stale writes cannot overwrite a new handover", async () => {
      const task = await createStaffFollowup(scope, input());
      const ack = { action: "ACKNOWLEDGE", expectedUpdatedAt: task.updatedAt.toISOString() };
      await assert.rejects(changeStaffFollowup(scope, task.id, ack), /FORBIDDEN/);
      const covered = await changeStaffFollowup({ ...scope, userId: cover.id }, task.id, ack);
      assert.ok(covered.coverAcknowledgedAt);
      await assert.rejects(changeStaffFollowup(scope, task.id, { action: "HANDOVER", coverId: null, expectedUpdatedAt: task.updatedAt.toISOString() }), /CONFLICT/);
      const handover = await changeStaffFollowup(scope, task.id, { action: "HANDOVER", coverId: staff.id, expectedUpdatedAt: covered.updatedAt.toISOString() });
      assert.equal(handover.coverAcknowledgedAt, null);
      await assert.rejects(changeStaffFollowup({ ...scope, userId: cover.id }, task.id, { action: "ACKNOWLEDGE", expectedUpdatedAt: handover.updatedAt.toISOString() }), /FORBIDDEN/);
    });
    await t.test("store, customer, inactive staff and revoked cover access are checked", async () => {
      await assert.rejects(createStaffFollowup(scope, { ...input(), facilityId: b.id }), /FORBIDDEN/);
      const otherCustomer = await db.customer.create({ data: { organisationId: org.id, firstName: "Other store private" } });
      await db.lead.create({ data: { customerId: otherCustomer.id, facilityId: b.id, source: "OTHER" } });
      await assert.rejects(createStaffFollowup(scope, { ...input(), customerId: otherCustomer.id }), /FORBIDDEN/);
      assert.equal((await listStaffFollowups(scope, "Other store private")).customers.length, 0);
      const task = await createStaffFollowup(scope, input());
      await db.user.update({ where: { id: cover.id }, data: { active: false } });
      await assert.rejects(createStaffFollowup(scope, input()), /FORBIDDEN/);
      await assert.rejects(changeStaffFollowup({ ...scope, userId: cover.id }, task.id, { action: "ACKNOWLEDGE", expectedUpdatedAt: task.updatedAt.toISOString() }), /FORBIDDEN/);
      await db.user.update({ where: { id: cover.id }, data: { active: true } });
      assert.equal((await listStaffFollowups({ ...scope, facilityIds: [b.id] })).tasks.length, 0);
    });
    await t.test("audit outage rolls back both creation and acknowledgement", async () => {
      const beforeCount = await db.task.count({ where: { organisationId: org.id } });
      const task = await createStaffFollowup(scope, input());
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_staff_followup_audit_failure CHECK (action NOT LIKE 'staff_followup.%') NOT VALID`);
      try {
        await assert.rejects(createStaffFollowup(scope, input()));
        await assert.rejects(changeStaffFollowup({ ...scope, userId: cover.id }, task.id, { action: "ACKNOWLEDGE", expectedUpdatedAt: task.updatedAt.toISOString() }));
        assert.equal(await db.task.count({ where: { organisationId: org.id } }), beforeCount + 1);
        assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).coverAcknowledgedAt, null);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_staff_followup_audit_failure'); }
    });
    await t.test("pagination retains later appointments beyond 100 and completion clears open queue", async () => {
      await db.task.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ organisationId: org.id, facilityId: a.id, customerId: customer.id, assigneeId: staff.id, purpose: "AGREED_FOLLOWUP", title: `Later appointment ${i}`, dueAt: new Date(`2026-10-16T07:00:00.000Z`) })) });
      const first = await listStaffFollowups(scope);
      assert.equal(first.tasks.length, 100); assert.ok(first.nextCursor);
      const next = await listStaffFollowups(scope, "", first.nextCursor!);
      assert.ok(next.tasks.length >= 5); assert.equal(next.nextCursor, null);
      assert.equal(next.tasks.some(task => first.tasks.some(previous => previous.id === task.id)), false);
      const task = first.tasks[0];
      await changeStaffFollowup(scope, task.id, { action: "COMPLETE", expectedUpdatedAt: task.updatedAt.toISOString() });
      assert.equal((await listStaffFollowups(scope)).tasks.some(row => row.id === task.id), false);
    });
  } finally { await db.$disconnect(); }
});
