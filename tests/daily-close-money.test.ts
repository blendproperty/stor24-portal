import assert from "node:assert/strict";
import test from "node:test";
import { dailyCloseSchema } from "../src/lib/validators";

const input = { facilityId: "c2222222222222222222222222", businessDate: "2026-01-01", expectedCash: 0, countedCash: 0, checks: [{ key: "review", label: "Synthetic check", complete: true }] };

test("daily-close cash rejects sub-cent and out-of-range values before database rounding", () => {
  for (const field of ["expectedCash", "countedCash"]) {
    for (const value of [0.005, 0.004, 1.001, 0.0000001, -0.01, 1_000_000_000_000, Infinity, NaN, "0.01"]) {
      assert.equal(dailyCloseSchema.safeParse({ ...input, [field]: value }).success, false, `${field}: ${value}`);
    }
    for (const value of [0, 0.01, 0.1, 0.29, 1.15, 123456.78, 999_999_999_999.99]) {
      const parsed = dailyCloseSchema.parse({ ...input, [field]: value });
      assert.equal(parsed[field as "expectedCash" | "countedCash"], value);
    }
  }
});
