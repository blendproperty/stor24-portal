import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { createScheduledWork, changeScheduledWork, scheduledWorkPage } from "../../src/lib/scheduled-work-service";
import { scheduledWorkSchema } from "../../src/lib/scheduled-work-policy";
import { getOperationsCalendar } from "../../src/lib/calendar-service";
import { protectUnitStructure, protectUnitTypeStructure } from "../../src/lib/inventory-structure-service";

test("isolated scheduled work retains recurrence history and enforces store, staff and audit boundaries", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const org = await db.organisation.create({ data: { name: "Schedule CI", slug: randomUUID() } });
  let constrained = false;
  try {
    const a = await db.facility.create({ data: { organisationId: org.id, code: "A", name: "A" } });
    const b = await db.facility.create({ data: { organisationId: org.id, code: "B", name: "B" } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Schedule CI", permissions: ["operations.view", "operations.manage"] } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "CI", email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: a.id } } } });
    const type = await db.unitType.create({ data: { facilityId: a.id, name: "5 sqm", areaSqMetres: 5 } });
    const unit = await db.unit.create({ data: { facilityId: a.id, unitTypeId: type.id, number: "A1", monthlyRate: 100 } });
    const scope = { organisationId: org.id, userId: user.id, facilityIds: [a.id], unrestrictedFacilities: false };
    const input = scheduledWorkSchema.parse({ facilityId: a.id, assigneeId: user.id, title: "Walkthrough CI", purpose: "CHECKLIST", startAt: "2026-10-23T08:00:00.000Z", endAt: "2026-10-23T10:00:00.000Z", repeat: "DAILY", occurrences: 3 });
    let id = "";
    await t.test("concurrent retries create one finite series; changed retry conflicts", async () => {
      const key = randomUUID();
      const results = await Promise.all([createScheduledWork(scope, input, key), createScheduledWork(scope, input, key)]);
      id = results[0].id; assert.equal(results[1].id, id);
      assert.equal(await db.task.count({ where: { organisationId: org.id } }), 3);
      assert.equal(await db.auditEvent.count({ where: { organisationId: org.id } }), 3);
      await assert.rejects(createScheduledWork(scope, { ...input, title: "Changed" }, key), /CONFLICT/);
    });
    await t.test("completion preserves siblings, records actor/time and rejects stale or closed edits", async () => {
      const task = await db.task.findUniqueOrThrow({ where: { id } });
      const once = { ...input, repeat: "ONCE" as const, occurrences: 1 };
      const after = await changeScheduledWork(scope, id, task.updatedAt.toISOString(), once, "COMPLETED");
      assert.ok(after.completedAt);
      assert.equal(await db.task.count({ where: { organisationId: org.id, status: "OPEN" } }), 2);
      await assert.rejects(changeScheduledWork(scope, id, after.updatedAt.toISOString(), once, "OPEN"), /CLOSED/);
      const sibling = await db.task.findFirstOrThrow({ where: { organisationId: org.id, status: "OPEN" } });
      await changeScheduledWork(scope, sibling.id, sibling.updatedAt.toISOString(), { ...once, title: "Edited occurrence" }, "OPEN");
      await assert.rejects(changeScheduledWork(scope, sibling.id, sibling.updatedAt.toISOString(), once, "OPEN"), /CONFLICT/);
    });
    await t.test("store access and current assignee eligibility hold", async () => {
      await assert.rejects(createScheduledWork({ ...scope, facilityIds: [] }, input, randomUUID()), /FORBIDDEN/);
      await assert.rejects(createScheduledWork(scope, { ...input, facilityId: b.id }, randomUUID()), /FORBIDDEN/);
      await db.role.update({ where: { id: role.id }, data: { permissions: [] } });
      await assert.rejects(createScheduledWork(scope, input, randomUUID()), /FORBIDDEN/);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["operations.view", "operations.manage"] } });
    });
    await t.test("audit failure rolls back every recurring occurrence", async () => {
      const before = await db.task.count({ where: { organisationId: org.id } });
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_schedule_audit_failure CHECK (false) NOT VALID'); constrained = true;
      await assert.rejects(createScheduledWork(scope, input, randomUUID()));
      assert.equal(await db.task.count({ where: { organisationId: org.id } }), before);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_schedule_audit_failure'); constrained = false;
    });
    await t.test("restriction and overlocking are separate tasks and never send an access command", async () => {
      for (const purpose of ["ACCESS_RESTRICTION", "PHYSICAL_OVERLOCK"] as const) await createScheduledWork(scope, { ...input, purpose, unitId: unit.id, repeat: "ONCE", occurrences: 1 }, randomUUID());
      const data = await scheduledWorkPage(scope, new Date("2026-10-23T00:00:00Z"), new Date("2026-10-30T00:00:00Z"));
      assert.equal(data.tasks.filter(t => t.unitId === unit.id).length, 2);
      assert.equal(await db.accessDecision.count({ where: { organisationId: org.id } }), 0);
      const privateTask = await db.task.create({ data: { organisationId: org.id, title: "Portfolio private", dueAt: new Date(input.endAt) } });
      const calendar = (await getOperationsCalendar(scope, new Date(input.startAt))).flatMap(d => d.items);
      assert.equal(calendar.some(t => t.id === privateTask.id), false);
      const planned = calendar.find(t => t.title === input.title);
      assert.ok(planned); assert.equal(planned.at.getUTCHours(), 8);
      assert.equal((await scheduledWorkPage({ ...scope, facilityIds: [] }, new Date(input.startAt), new Date("2026-10-30T00:00:00Z"))).tasks.length, 0);
    });
    await t.test("live reservations protect physical unit and type details; list rates remain editable", async () => {
      const customer = await db.customer.create({ data: { organisationId: org.id } });
      await db.reservation.create({ data: { facilityId: a.id, unitId: unit.id, customerId: customer.id, quotedRate: 90 } });
      await assert.rejects(db.$transaction(tx => protectUnitStructure(tx, a.id, unit.id, { floor: "First" })), /PROTECTED/);
      await assert.rejects(db.$transaction(tx => protectUnitTypeStructure(tx, a.id, type.id, { areaSqMetres: 6 })), /PROTECTED/);
      await db.$transaction(tx => protectUnitStructure(tx, a.id, unit.id, { monthlyRate: 120 }));
      await db.$transaction(tx => protectUnitTypeStructure(tx, a.id, type.id, { areaSqMetres: 5 }));
    });
  } finally {
    if (constrained) await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_schedule_audit_failure');
    await db.organisation.delete({ where: { id: org.id } }); await db.$disconnect();
  }
});
