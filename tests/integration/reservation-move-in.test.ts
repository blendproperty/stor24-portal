import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { confirmReservationMoveIn, getReservationMoveInReadiness } from "../../src/lib/reservation-move-in";
import { moveIn } from "../../src/lib/leasing-service";

test("isolated PostgreSQL signed reservation handover", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "CI only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key } });
    const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "CI staff" } });
    const customer = await db.customer.create({ data: { organisationId: org.id } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: key, features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: key, monthlyRate: 100, status: "RESERVED" } });
    const content = "Immutable CI signed agreement";
    const pdf = Buffer.from("CI signed PDF bytes");
    const startDate = new Date(Date.now() - 86400000);
    const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: startDate, publicLease: { create: {
      status: "SIGNED", version: "ci", paymentMethod: "EFT", content, clauses: [], sha256: createHash("sha256").update(content).digest("hex"), signingToken: randomUUID(), expiresAt: new Date(), signedAt: new Date(), signedPdf: pdf, signedPdfSha256: createHash("sha256").update(pdf).digest("hex"),
    } } } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ST24-T-${reservation.id}`, balance: -100 } });
    const payment = await db.payment.create({ data: { accountId: account.id, amount: 100, method: "EFT", status: "SUCCEEDED", processedAt: new Date(), idempotencyKey: key } });
    const receipt = await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: 100, description: "CI receipt", effectiveAt: new Date(), externalRef: key, createdById: user.id } });
    const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    return { org, facility, customer, unit, reservation, account, payment, receipt, scope, pdf, startDate };
  }
  async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
    assert.equal(await db.tenancy.count({ where: { accountId: f.account.id } }), 0);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: f.reservation.id } })).status, "ACTIVE");
    assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } })).status, "RESERVED");
  }
  try {
    await t.test("concurrent confirmation preserves the signed PDF, exact account, balance and payments", async () => {
      const f = await fixture();
      assert.equal((await getReservationMoveInReadiness(f.scope, f.reservation.id)).ready, true);
      const [a, b] = await Promise.all([confirmReservationMoveIn(f.scope, f.reservation.id), confirmReservationMoveIn(f.scope, f.reservation.id)]);
      assert.equal(a.tenancyId, b.tenancyId);
      const tenancy = await db.tenancy.findUniqueOrThrow({ where: { id: a.tenancyId }, include: { occupancies: true, documents: true } });
      assert.equal(tenancy.accountId, f.account.id);
      assert.equal(tenancy.status, "ACTIVE");
      assert.equal(tenancy.startDate.toISOString(), f.startDate.toISOString());
      assert.equal(tenancy.occupancies.length, 1);
      assert.equal(tenancy.occupancies[0].accessState, "PENDING");
      assert.equal(tenancy.documents.length, 1);
      assert.equal(tenancy.documents[0].provider, "PUBLIC_RESERVATION");
      assert.equal(tenancy.documents[0].status, "SIGNED");
      assert.equal((await db.publicReservationLease.findUniqueOrThrow({ where: { reservationId: f.reservation.id } })).signedPdf?.toString(), f.pdf.toString());
      assert.equal(await db.account.count({ where: { customerId: f.customer.id } }), 1);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 1);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), "-100");
      assert.equal(await db.auditEvent.count({ where: { entityId: a.tenancyId, action: "tenancy.key_handover_confirmed" } }), 1);
      assert.equal(await db.biometricEnrollment.count({ where: { customerId: f.customer.id } }), 0);
    });
    for (const status of ["PENDING", "FAILED", "TEST_SUCCEEDED"] as const) await t.test(`${status} payment cannot clear handover`, async () => {
      const f = await fixture();
      await db.payment.update({ where: { id: f.payment.id }, data: { status } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await unchanged(f);
    });
    await t.test("sandbox success and short payment are not cleared money", async () => {
      const f = await fixture();
      await db.payment.update({ where: { id: f.payment.id }, data: { idempotencyKey: `netcash-public-test-${randomUUID()}` } });
      assert.equal((await getReservationMoveInReadiness(f.scope, f.reservation.id)).testPayment, true);
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await db.payment.update({ where: { id: f.payment.id }, data: { idempotencyKey: f.payment.idempotencyKey, amount: 10 } });
      await db.ledgerEntry.update({ where: { id: f.receipt.id }, data: { amount: 10 } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await unchanged(f);
    });
    await t.test("signature, PDF integrity and future dates fail closed", async () => {
      const f = await fixture();
      await db.publicReservationLease.update({ where: { reservationId: f.reservation.id }, data: { status: "READY" } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await db.publicReservationLease.update({ where: { reservationId: f.reservation.id }, data: { status: "SIGNED", signedPdf: Buffer.from("changed") } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_DOCUMENT_REVIEW/);
      await db.publicReservationLease.update({ where: { reservationId: f.reservation.id }, data: { signedPdf: f.pdf } });
      await db.reservation.update({ where: { id: f.reservation.id }, data: { intendedMoveIn: new Date(Date.now() + 86400000) } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await unchanged(f);
    });
    await t.test("wrong organisation, facility and account owner cannot hand over", async () => {
      const f = await fixture();
      await assert.rejects(confirmReservationMoveIn({ ...f.scope, organisationId: "wrong" }, f.reservation.id), /NOT_FOUND/);
      await assert.rejects(confirmReservationMoveIn({ ...f.scope, facilityIds: [] }, f.reservation.id), /NOT_FOUND/);
      const other = await db.customer.create({ data: { organisationId: f.org.id } });
      await db.account.update({ where: { id: f.account.id }, data: { customerId: other.id } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await unchanged(f);
    });
    await t.test("reversed receipt and unavailable unit cannot hand over", async () => {
      const f = await fixture();
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "REVERSAL", amount: 100, reversalOfId: f.receipt.id, description: "CI reversal", effectiveAt: new Date() } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      const other = await fixture();
      await db.unit.update({ where: { id: other.unit.id }, data: { status: "SERVICE" } });
      await assert.rejects(confirmReservationMoveIn(other.scope, other.reservation.id), /MOVE_IN_NOT_READY/);
      await unchanged(f);
    });
    await t.test("legacy direct move-in cannot send another lease for a reserved signed unit", async () => {
      const f = await fixture();
      const input = { facilityId: f.facility.id, customerId: f.customer.id, unitId: f.unit.id, startDate: f.startDate, initialCharge: 0, accessState: "PENDING", paymentMethod: "EFT" as const };
      await assert.rejects(moveIn(f.scope, input), /CONFLICT/);
      await assert.rejects(moveIn(f.scope, { ...input, reservationId: f.reservation.id }), /SIGNED_RESERVATION_REQUIRES_HANDOVER/);
      await unchanged(f);
    });
    await t.test("a cancelled booking, missing receipt or payment for supplies cannot clear handover", async () => {
      const f = await fixture();
      await db.reservation.update({ where: { id: f.reservation.id }, data: { status: "CANCELLED" } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await db.reservation.update({ where: { id: f.reservation.id }, data: { status: "ACTIVE" } });
      await db.ledgerEntry.update({ where: { id: f.receipt.id }, data: { externalRef: "not-this-payment" } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await db.ledgerEntry.update({ where: { id: f.receipt.id }, data: { externalRef: f.payment.idempotencyKey } });
      await db.merchandiseOrder.create({ data: { accountId: f.account.id, organisationId: f.org.id, facilityId: f.facility.id, unitId: f.unit.id, total: 100, paymentId: f.payment.id, idempotencyKey: randomUUID(), expiresAt: new Date() } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await unchanged(f);
    });
    await t.test("booking packages count towards the required payment", async () => {
      const f = await fixture();
      await db.reservationPackage.create({ data: { reservationId: f.reservation.id, packageCode: "CI", packageName: "CI package", priceSnapshot: 50, itemsSnapshot: [] } });
      const view = await getReservationMoveInReadiness(f.scope, f.reservation.id);
      assert.equal(view.requiredAmount, 150);
      assert.equal(view.paidAmount, 100);
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await unchanged(f);
    });
    await t.test("provider success needs live provenance as well as its verified ledger receipt", async () => {
      const f = await fixture();
      await db.payment.update({ where: { id: f.payment.id }, data: { provider: "NETCASH", method: "PAY_NOW" } });
      await db.ledgerEntry.update({ where: { id: f.receipt.id }, data: { metadata: { paymentId: f.payment.id, verifiedStatus: { accepted: true } } } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      await db.ledgerEntry.update({ where: { id: f.receipt.id }, data: { metadata: { paymentId: f.payment.id, verifiedStatus: { accepted: true }, environment: "live" } } });
      assert.equal((await getReservationMoveInReadiness(f.scope, f.reservation.id)).ready, true);
      await confirmReservationMoveIn(f.scope, f.reservation.id);
    });
  } finally { await db.$disconnect(); }
});
