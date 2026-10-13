import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { monthlyPaymentsRelevant, readRentalPlan } from "../src/lib/public-rental-plan";
import { recurringUpfrontEvidence, chooseFuturePayments, recurringPaymentStatus } from "../src/lib/public-recurring-payments";
import { newPublicInitialRent } from "../src/lib/public-initial-rent";
import { findMandateLease } from "../src/lib/debit-mandate-session";
import { sendMonthlyMandateInvitation } from "../src/lib/monthly-mandate-invitation";

const payment = { id: "p-one", status: "TEST_SUCCEEDED", environment: "sandbox", idempotencyKey: "netcash-public-test-fixture", provider: "NETCASH", method: "PAY_NOW", currency: "ZAR", amount: 1290.32, processedAt: new Date() };
const date = new Date("2026-10-31T00:00:00+02:00");
function fixture() {
  return { id: "lease", reservationId: "r", status: "SIGNED", signedAt: new Date(), paymentMethod: "CARD", expiresAt: new Date(Date.now() + 86400000), mandate: null as Record<string, unknown> | null, reservation: { id: "r", customerId: "customer", facilityId: "facility", publicReference: "ST24-TEST", status: "ACTIVE", quotedRate: 1250, intendedMoveIn: date, initialRentSnapshot: newPublicInitialRent(1250, date), packageSelection: null, rentalPlan: { version: 1, expectedDuration: "LONGER", futurePaymentMethod: null as string | null }, customer: { id: "customer", type: "INDIVIDUAL", companyName: null, organisationId: "organisation", firstName: "Test", email: "customer@example.test", emailVerifiedAt: new Date() }, facility: {}, unit: { number: "TEST" } } };
}
function stub(target: object, name: string, fn: (...args: unknown[]) => unknown) { const original = Reflect.get(target, name); Reflect.set(target, name, fn); return () => Reflect.set(target, name, original); }

test("rental period is a forecast; one month suppresses opt-in while longer/unknown stays offer it", () => {
  assert.equal(monthlyPaymentsRelevant({ expectedDuration: "ONE_MONTH" }), false);
  for (const expectedDuration of ["TWO_TO_THREE_MONTHS", "FOUR_TO_SIX_MONTHS", "LONGER", "UNSURE"]) assert.equal(monthlyPaymentsRelevant({ expectedDuration }), true);
  assert.equal(readRentalPlan(null).expectedDuration, "UNSURE");
  assert.equal(readRentalPlan({ futurePaymentMethod: "unexpected" }).futurePaymentMethod, null);
});
test("confirmed failed retries may precede one successful test receipt, but ambiguity and reversals hold setup", () => {
  assert.equal(recurringUpfrontEvidence([{ ...payment, id: "failed", status: "FAILED" }, payment], [], 1290.32).ready, true);
  for (const payments of [[{ ...payment, status: "PENDING" }], [payment, { ...payment, id: "other" }], [payment, { ...payment, status: "PENDING" }], [{ ...payment, amount: 1 }]]) assert.equal(recurringUpfrontEvidence(payments, [], 1290.32).ready, false);
  assert.equal(recurringUpfrontEvidence([payment], [{ id: "reversal", type: "REVERSAL", amount: 1290.32, metadata: null, reversalOfId: null }], 1290.32).ready, false);
  assert.equal(recurringUpfrontEvidence([payment, { ...payment, id: "inconsistent", environment: "live" }], [], 1290.32).ready, false);
});
test("real success requires verified live ledger evidence; test evidence never becomes real paid rent", () => {
  const live = { ...payment, status: "SUCCEEDED", environment: "live", idempotencyKey: "netcash-real-fixture" };
  assert.equal(recurringUpfrontEvidence([live], [], 1290.32).ready, false);
  const receipts = [{ id: "receipt", type: "PAYMENT", amount: 1290.32, metadata: { paymentId: live.id, verifiedStatus: true, environment: "live" }, reversalOfId: null }];
  assert.equal(recurringUpfrontEvidence([live], receipts, 1290.32).ready, true);
  assert.equal(recurringUpfrontEvidence([live], receipts, 1290.32).isTest, false);
  assert.equal(recurringUpfrontEvidence([payment], [], 1290.32).isTest, true);
  assert.equal(recurringUpfrontEvidence([{ ...payment, status: "SUCCEEDED" }], [], 1290.32).ready, true); // Legacy sandbox success.
  for (const invalid of [{ ...payment, environment: "live" }, { ...payment, environment: null }, { ...payment, processedAt: null }, { ...payment, method: "EFT" }, { ...payment, provider: "OTHER" }]) assert.equal(recurringUpfrontEvidence([invalid], [], 1290.32).ready, false);
});
test("choice is durable/idempotent only after payment, and never changes the signed initial method", async () => {
  const lease = fixture(); let payments = [{ ...payment, status: "FAILED" }]; let updates = 0;
  const restores = [stub(db.publicReservationLease, "findUnique", async () => lease), stub(db.account, "findUnique", async () => ({ customerId: "customer", payments, ledgerEntries: [] })), stub(db, "$transaction", async callback => (callback as (tx: unknown) => unknown)({ $queryRaw: async () => [], reservation: { update: async (args: { data: { rentalPlan: typeof lease.reservation.rentalPlan } }) => { updates++; lease.reservation.rentalPlan = args.data.rentalPlan; } }, auditEvent: { create: async () => ({}) } }))];
  try {
    await assert.rejects(chooseFuturePayments("synthetic", "DEBIT_ORDER"), /UPFRONT_PAYMENT_REQUIRED/); assert.equal(updates, 0);
    payments = [payment];
    const status = await recurringPaymentStatus("synthetic");
    assert.equal(status.paymentReady, true); assert.equal(status.isTest, true); assert.equal(status.offered, true); assert.equal(status.collectionEnabled, false);
    await chooseFuturePayments("synthetic", "DEBIT_ORDER"); await chooseFuturePayments("synthetic", "DEBIT_ORDER");
    assert.equal(updates, 1); assert.equal(lease.paymentMethod, "CARD"); assert.equal(lease.reservation.rentalPlan.futurePaymentMethod, "DEBIT_ORDER");
    lease.mandate = { id: "existing" }; await assert.rejects(chooseFuturePayments("synthetic", "MANUAL"), /EXISTING_MANDATE_REVIEW_REQUIRED/);
  } finally { restores.reverse().forEach(r => r()); }
});
test("card agreement alone cannot start a mandate; opt-in and paid evidence are both required", async () => {
  const lease = fixture(); let payments = [payment];
  const restores = [stub(db.publicReservationLease, "findUnique", async () => lease), stub(db.account, "findUnique", async () => ({ customerId: "customer", payments, ledgerEntries: [] }))];
  try {
    await assert.rejects(findMandateLease("synthetic"), /UPFRONT_PAYMENT_REQUIRED/);
    lease.reservation.rentalPlan.futurePaymentMethod = "DEBIT_ORDER"; payments = [{ ...payment, status: "FAILED" }]; await assert.rejects(findMandateLease("synthetic"), /UPFRONT_PAYMENT_REQUIRED/);
    payments = [payment]; assert.equal((await findMandateLease("synthetic")).paymentMethod, "CARD");
    lease.mandate = { status: "SIGNED" }; payments = [{ ...payment, status: "FAILED" }]; assert.ok((await findMandateLease("synthetic")).mandate); // Historical signed document remains readable.
  } finally { restores.reverse().forEach(r => r()); }
});
test("wrong account owner cannot provide first-payment evidence", async () => {
  const lease = fixture(); const restores = [stub(db.publicReservationLease, "findUnique", async () => lease), stub(db.account, "findUnique", async () => ({ customerId: "other", payments: [payment], ledgerEntries: [] }))];
  try { await assert.rejects(recurringPaymentStatus("synthetic"), /NETCASH_ACCOUNT_CONFLICT/); } finally { restores.reverse().forEach(r => r()); }
});
test("one mandate invitation across concurrent devices; email failure never changes mandate status", async () => {
  const oldSetup = process.env.NETCASH_MANDATE_SETUP_ENABLED;
  const oldPolicy = process.env.NETCASH_MANDATE_POLICY;
  process.env.NETCASH_MANDATE_SETUP_ENABLED = "true";
  process.env.NETCASH_MANDATE_POLICY = JSON.stringify({ organisationId: "organisation", approvedBy: "Synthetic test", noticeDays: 30, holiday: "VeryNextOrdinaryBusinessDay", allowedDays: [1], recurringAmountBasis: "SIGNED_MONTHLY_RENT_ONLY", firstPaymentHandling: "SEPARATE_APPROVED_PAYMENT", postbackConfigured: true });
  const lease = fixture(); lease.reservation.rentalPlan.futurePaymentMethod = "DEBIT_ORDER";
  Object.assign(lease, { debitOrderPreferences: { firstCollectionDate: "2026-12-01", collectionDay: 1 } });
  const mandate = { id: "m", status: "AWAITING_SIGNATURE", terms: { amount: "1250", debitDay: 1, commencementMonth: 12 }, hostedUrl: "https://emandate.netcash.co.za/synthetic-only", invitationAttemptAt: null as Date | null, invitationSentAt: null as Date | null, invitationFailed: false };
  lease.mandate = mandate;
  const restores = [stub(db.publicReservationLease, "findUnique", async () => lease), stub(db.account, "findUnique", async () => ({ customerId: "customer", payments: [payment], ledgerEntries: [] }))];
  let sends = 0;
  const database = { publicDebitMandate: { updateMany: async () => { if (mandate.invitationAttemptAt) return { count: 0 }; mandate.invitationAttemptAt = new Date(); return { count: 1 }; }, update: async (args: { data: Partial<typeof mandate> }) => Object.assign(mandate, args.data) }, auditEvent: { create: async () => ({}) } };
  try {
    const send = async (message: { to: string; subject: string; text: string; html: string }) => { assert.equal(message.to, "customer@example.test"); assert.match(message.subject, /^TEST/); assert.ok(message.text.includes("\n")); assert.match(message.html, /Open secure Netcash signing/); sends++; };
    await Promise.all([sendMonthlyMandateInvitation("synthetic", false, database as never, send), sendMonthlyMandateInvitation("synthetic", false, database as never, send)]);
    assert.equal(sends, 1); assert.ok(mandate.invitationSentAt); assert.equal(mandate.status, "AWAITING_SIGNATURE");
    mandate.invitationAttemptAt = null; mandate.invitationSentAt = null;
    assert.equal(await sendMonthlyMandateInvitation("synthetic", false, database as never, async () => { throw new Error("Simulated email failure"); }), "FAILED");
    assert.equal(mandate.invitationFailed, true); assert.equal(mandate.status, "AWAITING_SIGNATURE"); assert.equal(mandate.invitationSentAt, null);
    mandate.invitationAttemptAt = null;
    const failedAudit = { ...database, auditEvent: { create: async () => { throw new Error("Synthetic audit failure"); } } };
    await assert.rejects(sendMonthlyMandateInvitation("synthetic", false, failedAudit as never, send), /Synthetic audit failure/);
    assert.ok(mandate.invitationSentAt); assert.equal(mandate.invitationFailed, false); assert.equal(mandate.status, "AWAITING_SIGNATURE");
    mandate.terms.amount = "950";
    assert.equal(await sendMonthlyMandateInvitation("synthetic", true, database as never, send), "NOT_READY"); assert.equal(sends, 2);
    lease.reservation.rentalPlan.futurePaymentMethod = "MANUAL";
    assert.equal(await sendMonthlyMandateInvitation("synthetic", false, database as never, send), "NOT_READY"); assert.equal(sends, 2);
  } finally { restores.reverse().forEach(r => r()); if (oldSetup === undefined) delete process.env.NETCASH_MANDATE_SETUP_ENABLED; else process.env.NETCASH_MANDATE_SETUP_ENABLED = oldSetup; if (oldPolicy === undefined) delete process.env.NETCASH_MANDATE_POLICY; else process.env.NETCASH_MANDATE_POLICY = oldPolicy; }
});
