import { test } from "node:test";
import assert from "node:assert/strict";
import { prorationPreview } from "../src/lib/proration-preview";
test("preview follows real calendar months, leap years and inclusive effective days", () => {
  assert.deepEqual(prorationPreview(2800, "2026-02-15"), { days: 28, remaining: 14, amount: 1400, dailyRate: 100 });
  assert.equal(prorationPreview(2900, "2028-02-29")?.amount, 100);
  assert.equal(prorationPreview(3000, "2026-04-01")?.amount, 3000);
  assert.equal(prorationPreview(3100, "2026-01-31")?.amount, 100);
  assert.equal(prorationPreview(1850, "2026-04-17")?.amount, 863.33);
  assert.equal(prorationPreview(0, "2026-10-01")?.amount, 0);
});
test("preview rejects invalid dates and rates instead of showing negative or nonfinite amounts", () => {
  for (const date of ["", "2026-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00"]) assert.equal(prorationPreview(1000, date), null);
  for (const rate of [-1, NaN, Infinity, 10_000_001]) assert.equal(prorationPreview(rate, "2026-10-01"), null);
});
