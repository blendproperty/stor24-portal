import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { trainingCommand } from "../../src/lib/move-in-training";
import { bookingTestPaymentSnapshot, recordBookingTestPayment } from "../../src/lib/booking-test-payment";
import { getReservationMoveInReadiness } from "../../src/lib/reservation-move-in";

test("isolated PostgreSQL booking test receipts preserve live finance and owner control", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Test receipt CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Allowed", code: key } });
  const other = await db.facility.create({ data: { organisationId: org.id, name: "Other", code: key + "other" } });
  const ownerRole = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
  const managerRole = await db.role.create({ data: { organisationId: org.id, name: "Facility manager", permissions: ["move_in.create"] } });
  const owner = await db.user.create({ data: { organisationId: org.id, email: key + "owner@example.invalid", name: "Owner", roleAssignments: { create: { roleId: ownerRole.id } } } });
  const manager = await db.user.create({ data: { organisationId: org.id, email: key + "manager@example.invalid", name: "Manager", roleAssignments: { create: { roleId: managerRole.id, facilityId: facility.id } } } });
  const denied = await db.user.create({ data: { organisationId: org.id, email: key + "denied@example.invalid", name: "Other store", roleAssignments: { create: { roleId: managerRole.id, facilityId: other.id } } } });
  const customer = await db.customer.create({ data: { organisationId: org.id } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: key, features: [] } });
  const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "CI", monthlyRate: 100, status: "RESERVED" } });
  const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: new Date(), publicLease: { create: { status: "SIGNED", version: "ci", paymentMethod: "EFT", content: "synthetic", clauses: [], sha256: "ci", signingToken: randomUUID(), expiresAt: new Date(), signedAt: new Date() } } } });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ST24-T-${reservation.id}`, balance: 0 } });
  const scope = { userId: owner.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  const unchanged = async () => ({
    account: await db.account.findUniqueOrThrow({ where: { id: account.id } }),
    payments: await db.payment.findMany({ where: { accountId: account.id } }),
    ledger: await db.ledgerEntry.findMany({ where: { accountId: account.id } }),
    reservation: await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } }),
    unit: await db.unit.findUniqueOrThrow({ where: { id: unit.id } }),
    tenancies: await db.tenancy.count({ where: { accountId: account.id } }),
    readiness: await getReservationMoveInReadiness(scope, reservation.id),
  });
  let constrained = false;
  try {
    const before = await unchanged();
    assert.equal(before.readiness.paymentVerified, false);
    const off = await bookingTestPaymentSnapshot(owner.id, reservation.id);
    await assert.rejects(recordBookingTestPayment(owner.id, { reservationId: reservation.id, generation: off.generation, amount: 100, testConfirmed: true }), /DISABLED/);
    const on = await trainingCommand(owner.id, { action: "toggle", enabled: true, version: 0 });
    const state = await bookingTestPaymentSnapshot(manager.id, reservation.id);
    const input = { reservationId: reservation.id, generation: state.generation, amount: 100, testConfirmed: true };
    await assert.rejects(bookingTestPaymentSnapshot(denied.id, reservation.id), /FORBIDDEN/);
    await assert.rejects(recordBookingTestPayment(denied.id, input), /FORBIDDEN/);
    await assert.rejects(recordBookingTestPayment(manager.id, { ...input, testConfirmed: false }));
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_test_receipt_failure CHECK (false) NOT VALID'); constrained = true;
    await assert.rejects(recordBookingTestPayment(manager.id, input));
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_test_receipt_failure'); constrained = false;
    assert.equal((await bookingTestPaymentSnapshot(owner.id, reservation.id)).receipt, null);
    const results = await Promise.all(Array.from({ length: 8 }, () => recordBookingTestPayment(manager.id, input)));
    assert.equal(new Set(results.map(r => r.receipt?.id)).size, 1);
    assert.equal(await db.auditEvent.count({ where: { entityId: reservation.id, action: "training.booking_payment_recorded" } }), 1);
    assert.equal((await bookingTestPaymentSnapshot(owner.id, reservation.id)).receipt?.amount, 100);
    await assert.rejects(recordBookingTestPayment(owner.id, { ...input, amount: 101 }), /EXISTS/);
    assert.deepEqual(await unchanged(), before);
    const disabled = await trainingCommand(owner.id, { action: "toggle", enabled: false, version: on.controlVersion });
    await assert.rejects(recordBookingTestPayment(manager.id, input), /DISABLED/);
    assert.equal((await bookingTestPaymentSnapshot(manager.id, reservation.id)).receipt, null);
    await trainingCommand(owner.id, { action: "toggle", enabled: true, version: disabled.controlVersion });
    await assert.rejects(recordBookingTestPayment(manager.id, input), /CHANGED/);
    assert.equal((await bookingTestPaymentSnapshot(owner.id, reservation.id)).receipt, null);
    await db.user.update({ where: { id: manager.id }, data: { active: false } });
    await assert.rejects(bookingTestPaymentSnapshot(manager.id, reservation.id), /FORBIDDEN/);
    assert.deepEqual(await unchanged(), before);
  } finally {
    if (constrained) await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_test_receipt_failure');
    await db.$disconnect();
  }
});
