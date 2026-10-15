import assert from "node:assert/strict";
import test from "node:test";
import { staffPaymentReviewReason } from "../src/lib/staff-payment-review-policy";
const payment = { id: "payment", status: "SUCCEEDED", amount: "100.00", currency: "ZAR", provider: "NETCASH", environment: "live", idempotencyKey: "recorded-provider-request", processedAt: new Date() };
const receipt = { id: "receipt", type: "PAYMENT", amount: "100", externalRef: null, metadata: { paymentId: payment.id, verifiedStatus: true, environment: "live" }, reversalOfId: null, createdById: null };
test("payment attention distinguishes pending and unresolved evidence from verified internal matching", () => {
  assert.equal(staffPaymentReviewReason({ ...payment, status: "PENDING" }, []), "AWAITING_CONFIRMATION");
  assert.equal(staffPaymentReviewReason(payment, []), "MISSING_RECEIPT");
  assert.equal(staffPaymentReviewReason(payment, [receipt, { ...receipt, id: "duplicate" }]), "DUPLICATE_RECEIPT");
  assert.equal(staffPaymentReviewReason(payment, [receipt]), null);
  assert.equal(staffPaymentReviewReason(payment, [{ ...receipt, amount: "100.01" }]), "SOURCE_REVIEW");
  assert.equal(staffPaymentReviewReason(payment, [{ ...receipt, metadata: { paymentId: payment.id } }]), "SOURCE_REVIEW");
  assert.equal(staffPaymentReviewReason({ ...payment, environment: null }, [receipt]), "SOURCE_REVIEW");
  assert.equal(staffPaymentReviewReason(payment, [receipt, { ...receipt, id: "reversal", type: "REVERSAL", reversalOfId: receipt.id }]), "SOURCE_REVIEW");
});
test("sandbox success, duplicate callbacks, terminal failures and corrections are never new settled money", () => {
  assert.equal(staffPaymentReviewReason({ ...payment, environment: "sandbox" }, []), null);
  assert.equal(staffPaymentReviewReason({ ...payment, status: "TEST_SUCCEEDED" }, []), null);
  assert.equal(staffPaymentReviewReason({ ...payment, status: "PENDING", idempotencyKey: "sandbox-request" }, []), null);
  for (const status of ["FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"]) assert.equal(staffPaymentReviewReason({ ...payment, status }, []), null);
  assert.equal(staffPaymentReviewReason({ ...payment, provider: null }, [{ ...receipt, externalRef: payment.idempotencyKey, createdById: "staff" }]), null);
  assert.equal(staffPaymentReviewReason({ ...payment, provider: null }, [{ ...receipt, externalRef: payment.idempotencyKey }]), "SOURCE_REVIEW");
});
