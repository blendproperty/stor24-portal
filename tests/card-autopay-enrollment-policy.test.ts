import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { cardEnrollmentConsent, unpaidCardInvoice, signCardRecord, readCardSubscription } from "../src/lib/payments/card-autopay-enrollment-policy";
import { netcashNotifyProjection } from "../src/lib/payments/netcash-notify-policy";
test("notify persistence drops card vault tokens, cardholder/card/IP fields and arbitrary data, retaining reconciliation hints", () => {
  const raw = new URLSearchParams({ Reference: "synthetic-reference", RequestTrace: "114.228862205218", Amount: "950.00", Method: "1", TransactionAccepted: "true", ccToken: "synthetic-vault-token", ccHolder: "Synthetic payer", ccMasked: "synthetic-mask", ccExpiry: "012030", CardHolderIpAddr: "192.0.2.1", arbitrary: "private text" });
  assert.deepEqual(netcashNotifyProjection(raw.toString()), { Reference: "synthetic-reference", RequestTrace: "114.228862205218", Amount: "950.00", Method: "1", TransactionAccepted: "true" });
  assert.throws(() => netcashNotifyProjection("Reference=a&Reference=b"), /INVALID/);
  assert.throws(() => netcashNotifyProjection("RequestTrace=" + "a".repeat(101)), /INVALID/);
});
test("approved unpaid source excludes paid/partial/arrears/future/changed-document ambiguity and never creates an enrollment fee", () => {
  const content = "Synthetic approved invoice", now = new Date("2026-10-14T10:00:00Z");
  const document = { id: "synthetic-document", idempotencyKey: "monthly-invoice:synthetic-account:2026-10", externalId: "CI-INVOICE", content, sha256: createHash("sha256").update(content).digest("hex"), status: "SENT" };
  const charge = { id: "synthetic-charge", type: "CHARGE", amount: "950.00", description: "Rent", effectiveAt: new Date("2026-10-01T00:00:00+02:00"), externalRef: "RENT-2026-10", metadata: { billingPeriod: "2026-10", invoiceNumber: "CI-INVOICE" } };
  const input = { accountId: "synthetic-account", balance: "950.00", entries: [charge], document };
  assert.equal(unpaidCardInvoice(input, now).initialAmount, "950.00");
  assert.throws(() => unpaidCardInvoice({ ...input, document: { ...document, content: content + "changed" } }, now), /INVOICE_REQUIRED/);
  assert.throws(() => unpaidCardInvoice({ ...input, balance: "0.00" }, now), /ALLOCATION_REVIEW/);
  assert.throws(() => unpaidCardInvoice({ ...input, entries: [{ ...charge, effectiveAt: new Date("2026-11-01") }] }, now), /ALLOCATION_REVIEW/);
  assert.throws(() => unpaidCardInvoice({ ...input, entries: [{ ...charge, metadata: { ...charge.metadata, invoiceNumber: "other" } }] }, now), /ALLOCATION_REVIEW/);
});
test("retained subscription signature is canonical, organisation-bound and covers approved amounts and dates", () => {
  const previous = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "synthetic-card-policy-secret-more-than-32-characters";
  try {
    const value = { version: 1 as const, accountId: "account", customerId: "customer", tenancyId: "tenancy", facilityId: "facility", organisationId: "org", requestId: "request", requestFingerprint: "a".repeat(64), sourceFingerprint: "b".repeat(64), checkoutPaymentId: "checkout", originalReference: "checkout", connectionId: "connection", merchantHash: "c".repeat(64), environment: "sandbox" as const, schedule: { cycles: 12, startDate: "2026-11-01" }, monthlyAmount: "950.00", documentId: "document", invoiceReference: "invoice", invoicePeriod: "2026-10", initialAmount: "950.00", consentText: cardEnrollmentConsent("950.00", "invoice", "950.00", { cycles: 12, startDate: "2026-11-01" }), consentAt: "2026-10-14T10:00:00Z" };
    const signed = signCardRecord(value);
    assert.equal(readCardSubscription(signed, { organisationId: "org", accountId: "account" }).monthlyAmount, "950.00");
    assert.throws(() => readCardSubscription({ ...signed, monthlyAmount: "951.00" }, { organisationId: "org" }), /INTEGRITY_REVIEW/);
    assert.throws(() => readCardSubscription(signed, { organisationId: "other" }), /SOURCE_REVIEW/);
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
