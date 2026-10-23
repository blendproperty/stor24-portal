import test from "node:test";
import assert from "node:assert/strict";
import { adjustedUnitRate, bulkUnitPricingSchema, unitPricingToken } from "../src/lib/bulk-unit-pricing";

test("unit rate adjustments use decimal cents and reject negative or overflowing results", () => {
  assert.equal(adjustedUnitRate("100.00", "PERCENT", 10), "110.00");
  assert.equal(adjustedUnitRate("100.00", "PERCENT", -10), "90.00");
  assert.equal(adjustedUnitRate("100.01", "AMOUNT", -0.01), "100.00");
  assert.equal(adjustedUnitRate("0.10", "PERCENT", 5), "0.11");
  assert.throws(() => adjustedUnitRate("100", "SET", 0), /RATE_OUT_OF_RANGE/);
  assert.throws(() => adjustedUnitRate("100", "PERCENT", -100), /RATE_OUT_OF_RANGE/);
  assert.throws(() => adjustedUnitRate("100", "PERCENT", -101), /RATE_OUT_OF_RANGE/);
  assert.throws(() => adjustedUnitRate("1", "SET", -1), /RATE_OUT_OF_RANGE/);
  assert.throws(() => adjustedUnitRate("10000000", "AMOUNT", 1), /RATE_OUT_OF_RANGE/);
});

test("pricing accepts only a bounded explicit selection and known adjustment fields", () => {
  const input = { facilityId: "store", unitIds: ["a", "b"], mode: "AMOUNT", value: 10, action: "preview" };
  assert.ok(bulkUnitPricingSchema.safeParse(input).success);
  for (const patch of [{ unitIds: [] }, { unitIds: ["a", "a"] }, { unitIds: Array.from({ length: 1001 }, (_, i) => String(i)) }, { value: Infinity }, { value: NaN }, { mode: "BILL_CUSTOMERS" }, { monthlyRate: 10 }]) {
    assert.equal(bulkUnitPricingSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert.notEqual(unitPricingToken({ ...input, version: 1 }), unitPricingToken({ ...input, version: 2 }));
});
