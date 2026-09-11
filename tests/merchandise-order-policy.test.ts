import assert from "node:assert/strict";
import test from "node:test";
import { amountInCents, assertMerchandiseFulfillable, merchandiseCancellationDecision, merchandisePaymentDecision, type MerchandiseOrderSnapshot } from "../src/lib/merchandise-order-policy";
const order: MerchandiseOrderSnapshot = { status: "AWAITING_PAYMENT", paymentReference: "payment-one", total: "125.97", currency: "ZAR", stockHeld: true };
const payment = { verified: true, accepted: true, reference: "payment-one", amount: "125.97", currency: "ZAR" };
test("merchandise requires verified matching reference, exact total and currency", () => {
  assert.deepEqual(merchandisePaymentDecision(order, payment), { status: "PAID", postPayment: true, releaseStock: false });
  for (const change of [{ verified: false }, { reference: "other" }, { amount: "10.00" }, { currency: "USD" }]) assert.throws(() => merchandisePaymentDecision(order, { ...payment, ...change }), /MISMATCH/);
  assert.equal(amountInCents("125.9"), 12590);
  for (const invalid of ["-1", "NaN", "1e2", "1.001", "", "Infinity"]) assert.throws(() => amountInCents(invalid));
});
test("duplicate or later declined notifications never regress paid orders", () => {
  for (const status of ["PAID", "FULFILLED", "PAYMENT_REVIEW"] as const) {
    assert.deepEqual(merchandisePaymentDecision({ ...order, status }, payment), { status, postPayment: false, releaseStock: false });
    assert.equal(merchandisePaymentDecision({ ...order, status }, { ...payment, accepted: false }).status, status);
  }
});
test("late payment enters review rather than resurrecting released stock", () => {
  for (const status of ["CANCELLED", "EXPIRED"] as const) assert.deepEqual(merchandisePaymentDecision({ ...order, status, stockHeld: false }, payment), { status: "PAYMENT_REVIEW", postPayment: true, releaseStock: false });
  assert.equal(merchandisePaymentDecision({ ...order, stockHeld: false }, payment).status, "PAYMENT_REVIEW");
});
test("cancellation releases only unpaid held stock; fulfilment requires paid held stock", () => {
  assert.deepEqual(merchandiseCancellationDecision(order, true), { status: "EXPIRED", releaseStock: true });
  assert.equal(merchandiseCancellationDecision({ ...order, status: "PAID" }).releaseStock, false);
  assert.throws(() => assertMerchandiseFulfillable(order));
  assert.throws(() => assertMerchandiseFulfillable({ ...order, status: "PAID", stockHeld: false }));
  assert.doesNotThrow(() => assertMerchandiseFulfillable({ ...order, status: "PAID" }));
});
