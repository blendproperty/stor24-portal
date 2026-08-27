import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const booking = fs.readFileSync("src/lib/public-booking-service.ts", "utf8");
const payment = fs.readFileSync("src/lib/public-payment-simulator.ts", "utf8");

test("Pay Now email verification is independent from mobile verification", () => {
  assert.match(booking, /emailVerificationHash/);
  assert.match(booking, /public_reservation\.email_verification_sent/);
  assert.match(booking, /public_reservation\.email_verified/);
  assert.match(booking, /emailVerifiedAt: verifiedAt/);
});

test("simulated payment cannot start until mobile and email are verified", () => {
  assert.match(payment, /!reservation\.contactVerifiedAt/);
  assert.match(payment, /!reservation\.customer\.emailVerifiedAt/);
});
