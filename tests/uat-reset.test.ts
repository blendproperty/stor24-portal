import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const route = fs.readFileSync("src/app/api/v1/admin/uat-reset/route.ts", "utf8");
const service = fs.readFileSync("src/lib/uat-reset-service.ts", "utf8");
const inventoryWorkspace = fs.readFileSync("src/components/unit-inventory-workspace.tsx", "utf8");

test("UAT reset is owner-only, same-origin and requires an exact confirmation", () => {
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requireOwner\(\)/);
  assert.match(route, /RESET TEST CUSTOMERS/);
});

test("UAT reset preserves core inventory while removing customer workflow records", () => {
  assert.match(service, /customer\.deleteMany/);
  assert.match(service, /reservation\.deleteMany/);
  assert.match(service, /tenancy\.deleteMany/);
  assert.match(service, /account\.deleteMany/);
  assert.match(service, /status: \{ in: \["HELD", "RESERVED", "OCCUPIED"\] \}/);
  assert.doesNotMatch(service, /facility\.delete/);
  assert.doesNotMatch(service, /unit\.delete/);
  assert.doesNotMatch(service, /unitType\.delete/);
  assert.match(service, /uat\.customer_data_reset/);
});

test("UAT reset preview exposes the exact confirmation input before enabling deletion", () => {
  assert.match(inventoryWorkspace, /value=\{uatResetConfirmation\}/);
  assert.match(inventoryWorkspace, /setUatResetConfirmation\(event\.target\.value\)/);
  assert.match(inventoryWorkspace, /uatResetConfirmation !== "RESET TEST CUSTOMERS"/);
});
