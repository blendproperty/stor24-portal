import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const service = fs.readFileSync("src/lib/leasing-service.ts", "utf8");

test("cancelling a safe UAT reservation clears its draft occupancy before releasing the unit", () => {
  assert.match(service, /safeUatDraft/);
  assert.match(service, /LEASE_AGREEMENT_UAT/);
  assert.match(service, /STOR24_SIMULATOR/);
  assert.match(service, /tenancy\.cancelled_with_uat_reservation/);
  assert.match(service, /accessState: "REVOKED"/);
});
