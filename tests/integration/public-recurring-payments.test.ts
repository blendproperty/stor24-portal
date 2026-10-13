import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { newPublicInitialRent } from "../../src/lib/public-initial-rent";
import { chooseFuturePayments } from "../../src/lib/public-recurring-payments";
import { sendMonthlyMandateInvitation } from "../../src/lib/monthly-mandate-invitation";

test("isolated PostgreSQL serialises opt-in and claims one email without charging or changing the lease", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No external transport in isolated test"); });
  const key = randomUUID();
  const organisation = await db.organisation.create({ data: { name: "Monthly choice CI", slug: key } });
  const customer = await db.customer.create({ data: { organisationId: organisation.id, firstName: "Synthetic", email: `${key}@example.invalid`, emailVerifiedAt: new Date() } });
  const facility = await db.facility.create({ data: { organisationId: organisation.id, name: "CI", code: key } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI", features: [] } });
  const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: key, monthlyRate: 1250 } });
  const moveIn = new Date("2026-10-31T00:00:00+02:00");
  const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 1250, intendedMoveIn: moveIn, initialRentSnapshot: newPublicInitialRent(1250, moveIn), rentalPlan: { version: 1, expectedDuration: "LONGER", futurePaymentMethod: null }, publicLease: { create: { status: "SIGNED", signedAt: new Date(), version: "ci", paymentMethod: "CARD", content: "Synthetic immutable lease", sha256: "ci-hash", clauses: [], signingToken: key, expiresAt: new Date(Date.now() + 86400000), debitOrderPreferences: { firstCollectionDate: "2026-12-01", collectionDay: 1 } } } }, include: { publicLease: true } });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ST24-T-${reservation.id}` } });
  const oldSetup = process.env.NETCASH_MANDATE_SETUP_ENABLED, oldPolicy = process.env.NETCASH_MANDATE_POLICY;
  process.env.NETCASH_MANDATE_SETUP_ENABLED = "true";
  process.env.NETCASH_MANDATE_POLICY = JSON.stringify({ organisationId: organisation.id, approvedBy: "Synthetic CI", noticeDays: 30, holiday: "VeryNextOrdinaryBusinessDay", allowedDays: [1], recurringAmountBasis: "SIGNED_MONTHLY_RENT_ONLY", firstPaymentHandling: "SEPARATE_APPROVED_PAYMENT", postbackConfigured: true });
  try {
    await assert.rejects(chooseFuturePayments(key, "DEBIT_ORDER"), /UPFRONT_PAYMENT_REQUIRED/);
    await db.payment.create({ data: { accountId: account.id, status: "SUCCEEDED", processedAt: new Date(), environment: "sandbox", amount: 1290.32, currency: "ZAR", method: "PAY_NOW", provider: "NETCASH", idempotencyKey: `netcash-public-test-${key}` } });
    await Promise.all([chooseFuturePayments(key, "DEBIT_ORDER"), chooseFuturePayments(key, "DEBIT_ORDER")]);
    assert.equal(await db.auditEvent.count({ where: { entityId: reservation.id, action: "public_booking.future_payment_choice" } }), 1);
    const mandate = await db.publicDebitMandate.create({ data: { leaseId: reservation.publicLease!.id, reference: `CI-${key}`, correlation: key, environment: "sandbox", status: "AWAITING_SIGNATURE", hostedUrl: "https://emandate.netcash.co.za/synthetic", terms: { amount: "1250", debitDay: 1, commencementMonth: 12 } } });
    let sends = 0;
    const send = async () => { sends++; };
    await Promise.all([sendMonthlyMandateInvitation(key, false, db, send), sendMonthlyMandateInvitation(key, false, db, send)]);
    assert.equal(sends, 1);
    assert.ok((await db.publicDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })).invitationSentAt);
    await assert.rejects(chooseFuturePayments(key, "MANUAL"), /EXISTING_MANDATE_REVIEW_REQUIRED/);
    const lease = await db.publicReservationLease.findUniqueOrThrow({ where: { id: reservation.publicLease!.id } });
    assert.equal(lease.paymentMethod, "CARD"); assert.equal(lease.content, "Synthetic immutable lease"); assert.equal(lease.sha256, "ci-hash");
    assert.equal(await db.payment.count({ where: { accountId: account.id } }), 1);
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id } }), 0);
  } finally {
    if (oldSetup === undefined) delete process.env.NETCASH_MANDATE_SETUP_ENABLED; else process.env.NETCASH_MANDATE_SETUP_ENABLED = oldSetup;
    if (oldPolicy === undefined) delete process.env.NETCASH_MANDATE_POLICY; else process.env.NETCASH_MANDATE_POLICY = oldPolicy;
    await db.$disconnect();
  }
});
