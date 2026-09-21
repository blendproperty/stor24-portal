import assert from "node:assert/strict";
import test from "node:test";
import { mriMonthRange, mriSettingsSchema, summariseMriSource, type MriSourceRow } from "../src/lib/mri-policy";

test("MRI month boundaries use SAST and reject malformed or future months", () => {
  const period = mriMonthRange("2026-01", new Date("2026-09-21"));
  assert.equal(period.start.toISOString(), "2025-12-31T22:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-01-31T22:00:00.000Z");
  assert.equal(mriMonthRange("2026-09", new Date("2026-09-21")).partial, true);
  for (const value of ["2026-13", "2026-00", "2026-1", "2026-10", "", "2026-01-01"]) assert.throws(() => mriMonthRange(value, new Date("2026-09-21")), /MRI_MONTH/);
});
test("MRI settings require paired replacement and reject posting/endpoint injection", () => {
  const input = { revision: null, databaseLabel: "CI", environment: "unknown" };
  assert.equal(mriSettingsSchema.safeParse(input).success, true);
  for (const fields of [{ login: "user" }, { password: "fixture" }, { postingEnabled: true }, { endpoint: "https://example.invalid" }]) assert.equal(mriSettingsSchema.safeParse({ ...input, ...fields }).success, false);
});
test("MRI source review preserves exact cents and separates all test-account movements", () => {
  const row: MriSourceRow = { id: "1", accountId: "live", facilityId: "store", facilityName: "CI store", type: "CHARGE", amount: "0.10", taxAmount: "0.01", effectiveAt: "2026-01-01T00:00:00Z" };
  const rows = [row, { ...row, id: "2", amount: "0.20" }, { ...row, id: "3", accountId: "test", amount: "100.00" }, { ...row, id: "4", facilityId: null, facilityName: null, type: "REFUND", amount: "1.00" }];
  const result = summariseMriSource(rows, new Set(["test"]));
  assert.equal(result.excluded, 1); assert.equal(result.unassigned, 1);
  assert.deepEqual(result.groups.find(g => g.type === "CHARGE"), { facility: "CI store", type: "CHARGE", count: 2, amount: "0.30", tax: "0.02" });
  assert.equal(result.fingerprint, summariseMriSource([...rows].reverse(), new Set(["test"])).fingerprint);
  assert.notEqual(result.fingerprint, summariseMriSource(rows, new Set()).fingerprint);
  assert.notEqual(result.fingerprint, summariseMriSource(rows.map(r => ({ ...r, taxAmount: "0.02" })), new Set(["test"])).fingerprint);
});
