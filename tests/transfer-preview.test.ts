import test from "node:test";
import assert from "node:assert/strict";
import { transferRentPreview } from "../src/lib/transfer-preview";

test("transfer estimate uses actual calendar days and rounded rent segments", () => {
  assert.deepEqual(transferRentPreview("2026-11-16", "1200.00", "1800.00"), { days: 30, newDays: 15, difference: 300 });
  assert.equal(transferRentPreview("2026-11-16", "1800", "1200")?.difference, -300);
  assert.equal(transferRentPreview("2028-02-29", "2900", "5800")?.difference, 100);
  assert.equal(transferRentPreview("2026-02-29", "1000", "2000"), null);
  assert.equal(transferRentPreview("2026-11-01", "1000", "NaN"), null);
  assert.equal(transferRentPreview("2026-11-01", "1000", "1000")?.difference, 0);
  assert.equal(transferRentPreview("2026-11-31", "1000", "2000"), null);
});
