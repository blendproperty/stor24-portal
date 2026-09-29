import test from "node:test";
import assert from "node:assert/strict";
import { bookingTestPaymentSchema } from "../src/lib/booking-test-payment-contract";
test("booking simulation requires explicit test confirmation, generation and valid cents", () => {
  const input = { reservationId: "synthetic", generation: 1, amount: 2199, testConfirmed: true };
  assert.ok(bookingTestPaymentSchema.safeParse(input).success);
  for (const amount of [0, -1, 1.001, NaN, Infinity, 10000001]) assert.equal(bookingTestPaymentSchema.safeParse({ ...input, amount }).success, false);
  for (const patch of [{ testConfirmed: false }, { generation: -1 }, { generation: 0.5 }, { reservationId: "" }]) assert.equal(bookingTestPaymentSchema.safeParse({ ...input, ...patch }).success, false);
});
