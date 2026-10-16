import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { createTrainingDebtor, trainingDebtors } from "../../src/lib/training-debtor-service";

test("shared persisted training debtor stays isolated from finances and other stores", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const org = await db.organisation.create({ data: { name: "Training debtor isolated CI", slug: randomUUID() } });
  const store = await db.facility.create({ data: { organisationId: org.id, name: "Midpoint CI", code: "A" } });
  const other = await db.facility.create({ data: { organisationId: org.id, name: "Other store", code: "B" } });
  async function user(name: string, permissions: string[], facilityId?: string, owner = false) {
    const user = await db.user.create({ data: { organisationId: org.id, name, email: `${randomUUID()}@example.invalid` } });
    const role = await db.role.create({ data: { organisationId: org.id, name: owner ? "Organisation owner" : `Custom access · ${user.id}`, permissions } });
    await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId } });
    return user;
  }
  try {
    const owner = await user("Owner", ["*"], undefined, true);
    const faeez = await user("Faeez scoped CI", ["move_in.create", "leads.view"], store.id);
    const cover = await user("Cover", ["move_in.create"], store.id);
    const foreign = await user("Other store", ["move_in.create"], other.id);
    const denied = await user("No training permission", ["leads.view"], store.id);
    await t.test("only current owner can create; rejects unknown/foreign stores", async () => {
      await assert.rejects(createTrainingDebtor(faeez.id, { facilityId: store.id }), /FORBIDDEN/);
      await assert.rejects(createTrainingDebtor(owner.id, { facilityId: "unowned-store" }), /FORBIDDEN/);
      await assert.rejects(trainingDebtors(denied.id), /FORBIDDEN/);
      assert.equal(await db.customer.count({ where: { organisationId: org.id } }), 0);
    });
    let customerId = "";
    await t.test("concurrent retries create one real test profile and one immutable training event", async () => {
      const results = await Promise.all([createTrainingDebtor(owner.id, { facilityId: store.id }), createTrainingDebtor(owner.id, { facilityId: store.id })]);
      customerId = results[0].rows[0].customerId;
      assert.equal(results[1].rows[0].customerId, customerId);
      assert.equal(await db.customer.count({ where: { organisationId: org.id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: org.id, action: "training.debtor_created" } }), 1);
      const profile = await db.customer.findUniqueOrThrow({ where: { id: customerId }, include: { leads: true } });
      assert.equal(profile.firstName, "TEST"); assert.equal(profile.email, null); assert.equal(profile.phone, null);
      assert.equal(profile.leads.length, 1); assert.equal(profile.leads[0].stage, "LOST");
      assert.equal(profile.leads[0].facilityId, store.id);
    });
    await t.test("staff see the same saved R600 after a fresh read; outside-store staff see none", async () => {
      const f = await trainingDebtors(faeez.id), c = await trainingDebtors(cover.id);
      assert.equal(f.canCreate, false); assert.equal(f.rows[0].customerId, customerId);
      assert.equal(f.rows[0].outstandingCents, 60000); assert.deepEqual(c.rows, f.rows);
      assert.equal((await trainingDebtors(foreign.id)).rows.length, 0);
      await db.roleAssignment.deleteMany({ where: { userId: faeez.id } });
      await assert.rejects(trainingDebtors(faeez.id), /FORBIDDEN/);
    });
    await t.test("failed audit rolls back the profile and store link", async () => {
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "training_debtor_ci_failure" CHECK (NOT ("action" = 'training.debtor_created' AND "facilityId" = '${other.id}')) NOT VALID`);
      try { await assert.rejects(createTrainingDebtor(owner.id, { facilityId: other.id })); }
      finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT "training_debtor_ci_failure"'); }
      assert.equal(await db.customer.count({ where: { organisationId: org.id } }), 1);
      assert.equal(await db.lead.count({ where: { facilityId: other.id } }), 0);
    });
    await t.test("no financial, reservation, access or communication records created", async () => {
      const counts = await Promise.all([
        db.account.count({ where: { customer: { organisationId: org.id } } }),
        db.payment.count({ where: { account: { customer: { organisationId: org.id } } } }),
        db.ledgerEntry.count({ where: { account: { customer: { organisationId: org.id } } } }),
        db.tenancy.count({ where: { facility: { organisationId: org.id } } }),
        db.reservation.count({ where: { facility: { organisationId: org.id } } }),
        db.occupancy.count({ where: { tenancy: { facility: { organisationId: org.id } } } }),
        db.communicationLog.count({ where: { organisationId: org.id } }),
        db.biometricEnrollment.count({ where: { organisationId: org.id } }),
        db.task.count({ where: { organisationId: org.id } }),
      ]);
      assert.deepEqual(counts, Array(9).fill(0));
    });
    await t.test("foreign organisation owner cannot see the example; inactive owner cannot read", async () => {
      const foreignOrg = await db.organisation.create({ data: { name: "Foreign CI", slug: randomUUID() } });
      const otherOwner = await db.user.create({ data: { organisationId: foreignOrg.id, name: "Foreign owner", email: `${randomUUID()}@example.invalid` } });
      const otherRole = await db.role.create({ data: { organisationId: foreignOrg.id, name: "Organisation owner", permissions: ["*"] } });
      await db.roleAssignment.create({ data: { userId: otherOwner.id, roleId: otherRole.id } });
      assert.equal((await trainingDebtors(otherOwner.id)).rows.length, 0);
      await db.user.update({ where: { id: owner.id }, data: { active: false } });
      await assert.rejects(trainingDebtors(owner.id), /FORBIDDEN/);
      await assert.rejects(createTrainingDebtor(owner.id, { facilityId: store.id }), /FORBIDDEN/);
    });
  } finally { await db.$disconnect(); }
});
