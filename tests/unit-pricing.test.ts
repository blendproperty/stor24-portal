import assert from "node:assert/strict";
import test from "node:test";
import { recommendedMidrandMonthlyRate } from "../src/lib/unit-pricing";

test("Midrand market curve anchors common sizes and tapers for larger units", () => {
  assert.equal(recommendedMidrandMonthlyRate(3, "Ground floor"), 750);
  assert.equal(recommendedMidrandMonthlyRate(5, "Ground floor"), 1000);
  assert.equal(recommendedMidrandMonthlyRate(10, "Ground floor"), 1550);
  assert.equal(recommendedMidrandMonthlyRate(20, "Ground floor"), 2550);
  assert.equal(recommendedMidrandMonthlyRate(36, "Ground floor"), 4000);
  assert.equal(recommendedMidrandMonthlyRate(69, "Ground floor"), 6150);
});

test("upper floors receive an access discount rounded to R50", () => {
  assert.equal(recommendedMidrandMonthlyRate(6, "First floor"), 1000);
  assert.equal(recommendedMidrandMonthlyRate(6, "Second floor"), 950);
});
