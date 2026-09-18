import assert from "node:assert/strict";
import test from "node:test";
import { isTestPayment, isFinancialReceipt } from "../src/lib/payments/payment-evidence";
import { reservationReceiptSchema } from "../src/lib/reservation-payment";

test("sandbox evidence never becomes a financial receipt, including historical success", () => {
  const legacy = { status: "SUCCEEDED", idempotencyKey: "netcash-public-test-booking" };
  assert.equal(isTestPayment(legacy), true);
  assert.equal(isFinancialReceipt(legacy), false);
  assert.equal(isFinancialReceipt({ status: "TEST_SUCCEEDED", idempotencyKey: "opaque" }), false);
  assert.equal(isFinancialReceipt({ status: "SUCCEEDED", environment: "sandbox", idempotencyKey: "opaque" }), false);
  assert.equal(isFinancialReceipt({ status: "SUCCEEDED", environment: "live", idempotencyKey: "receipt" }), true);
});
test("booking receipt requires real funds, cents, a reference and a non-future date", () => {
  const valid = { reservationId: "booking", requestId: "c1492ce0-c7b3-4c58-9eb5-4cd721f25c58", amount: 100, method: "EFT", reference: "BANK-123", receivedAt: new Date(Date.now() - 1000), realPaymentConfirmed: true };
  assert.equal(reservationReceiptSchema.safeParse(valid).success, true);
  for (const change of [{ realPaymentConfirmed: false }, { amount: 1.001 }, { amount: -1 }, { reference: "" }, { receivedAt: new Date(Date.now() + 86400000) }]) assert.equal(reservationReceiptSchema.safeParse({ ...valid, ...change }).success, false);
});
