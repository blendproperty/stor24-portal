import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { bookingMoveInTrainingSnapshot, bookingMoveInTrainingCommand } from "../../src/lib/booking-move-in-training";
import { trainingCommand } from "../../src/lib/move-in-training";
import { bookingTestPaymentSnapshot, recordBookingTestPayment } from "../../src/lib/booking-test-payment";
import { getReservationMoveInReadiness, confirmReservationMoveIn } from "../../src/lib/reservation-move-in";

test("isolated PostgreSQL booking test receipts preserve live finance and owner control", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Booking test attempted external transport"); });
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
  const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: new Date(), publicLease: { create: { status: "SIGNED", version: "ci", paymentMethod: "EFT", content: "synthetic", clauses: [], sha256: "ci", signingToken: randomUUID(), expiresAt: new Date(), signedAt: new Date(), signedPdfSha256: "ci" } } } });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ST24-T-${reservation.id}`, balance: 0 } });
  const scope = { userId: owner.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  const unchanged = async () => ({
    account: await db.account.findUniqueOrThrow({ where: { id: account.id } }),
    payments: await db.payment.findMany({ where: { accountId: account.id } }),
    identity: await db.identityDocument.findMany({ where: { reservationId: reservation.id } }),
    photos: await db.facialPhotoSubmission.findMany({ where: { reservationId: reservation.id } }),
    occupancies: await db.occupancy.findMany({ where: { unitId: unit.id } }),
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
    // Run the full test on the actual booking while preserving every live gate and record.
    const linkedInput = { action: "start" as const, facilityId: facility.id, reservationId: reservation.id, generation: state.generation };
    await assert.rejects(bookingMoveInTrainingSnapshot(denied.id, reservation.id), /FORBIDDEN/);
    await assert.rejects(bookingMoveInTrainingCommand(manager.id, { ...linkedInput, facilityId: other.id }), /FORBIDDEN/);
    await assert.rejects(bookingMoveInTrainingCommand(manager.id, { ...linkedInput, generation: state.generation + 1 }), /CHANGED/);
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_linked_training_failure CHECK (false) NOT VALID');
    try { await assert.rejects(bookingMoveInTrainingCommand(manager.id, linkedInput)); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_linked_training_failure'); }
    assert.equal((await bookingMoveInTrainingSnapshot(manager.id, reservation.id)).run, null);
    let linked = await bookingMoveInTrainingCommand(manager.id, linkedInput);
    assert.equal(linked.booking!.unitNumber, "CI");
    assert.equal(linked.run!.state.unit, unit.id);
    assert.equal(linked.run!.state.bookingRequired, 100);
    assert.equal(linked.run!.state.agreement, true);
    assert.equal(linked.run!.state.paid, 100);
    assert.deepEqual(await bookingMoveInTrainingCommand(manager.id, linkedInput), linked);
    assert.equal((await bookingMoveInTrainingSnapshot(owner.id, reservation.id)).run, null);
    const identityInput = { ...linkedInput, action: "identity" as const, version: linked.run!.version, value: "confirmed" };
    const races = await Promise.allSettled(Array.from({length:8}, () => bookingMoveInTrainingCommand(manager.id, identityInput)));
    assert.equal(races.filter(r => r.status === "fulfilled").length, 1);
    linked = await bookingMoveInTrainingSnapshot(manager.id, reservation.id);
    assert.equal(linked.run!.state.identity, true);
    const transition = async (action: "photo" | "preview" | "approve" | "reject" | "handover", value?: string, sample = false) => {
      linked = await bookingMoveInTrainingCommand(manager.id, { ...linkedInput, action, version: linked.run!.version, value }, sample);
    };
    await assert.rejects(transition("handover", "confirmed"), /STEP_REQUIRED/);
    await assert.rejects(transition("photo"), /SAMPLE_REQUIRED/);
    await transition("photo", undefined, true);
    await assert.rejects(transition("approve"), /STEP_REQUIRED/);
    await transition("preview"); await transition("reject");
    await transition("photo", undefined, true); await transition("preview"); await transition("approve");
    await transition("handover", "confirmed");
    assert.ok(linked.run!.state.handedOverAt);
    await assert.rejects(confirmReservationMoveIn(scope, reservation.id), /MOVE_IN_NOT_READY/);
    const secondUnit = await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"CI2",monthlyRate:200,status:"RESERVED"}});
    const secondBooking = await db.reservation.create({data:{facilityId:facility.id,customerId:customer.id,unitId:secondUnit.id,quotedRate:200,intendedMoveIn:new Date()}});
    assert.equal((await bookingMoveInTrainingSnapshot(manager.id, secondBooking.id)).run, null);
    const secondTest = await bookingMoveInTrainingCommand(manager.id, {...linkedInput,reservationId:secondBooking.id});
    assert.equal(secondTest.run!.state.paid,0);
    assert.equal(secondTest.run!.state.agreement,false);
    assert.equal(secondTest.run!.state.bookingRequired,200);
    await assert.rejects(bookingMoveInTrainingCommand(manager.id,{...linkedInput,reservationId:secondBooking.id,action:"identity",version:secondTest.run!.version,value:"confirmed"}), /STEP_REQUIRED/);
    assert.deepEqual(await bookingMoveInTrainingSnapshot(manager.id,reservation.id),linked);

    assert.deepEqual(await unchanged(), before);
    await assert.rejects(bookingMoveInTrainingCommand(manager.id, { ...linkedInput, action: "reset", version: linked.run!.version }), /FORBIDDEN/);
    await assert.rejects(transition("handover", "confirmed"), /FINISHED/);
    const disabled = await trainingCommand(owner.id, { action: "toggle", enabled: false, version: on.controlVersion });
    await assert.rejects(recordBookingTestPayment(manager.id, input), /DISABLED/);
    assert.equal((await bookingTestPaymentSnapshot(manager.id, reservation.id)).receipt, null);
    await assert.rejects(bookingMoveInTrainingCommand(manager.id, { ...identityInput, version: linked.run!.version }), /DISABLED/);
    assert.equal((await bookingMoveInTrainingSnapshot(manager.id, reservation.id)).run, null);
    await trainingCommand(owner.id, { action: "toggle", enabled: true, version: disabled.controlVersion });
    await assert.rejects(bookingMoveInTrainingCommand(manager.id, linkedInput), /CHANGED/);
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
