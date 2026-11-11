import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { currentRoleAccess } from "../src/lib/current-role-access";

test("facility manager template matches migration and stays within its assigned store", () => {
  const source = readFileSync("src/lib/invitation-service.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20261111090000_facility_manager_billing_schedule/migration.sql", "utf8");
  const list = source.match(/name: "Facility manager", permissions: \[([^\]]+)\]/)?.[1];
  assert.ok(list);
  const grants = [...list.matchAll(/"([^"]+)"/g)].map(item => item[1]);
  const sql = migration.match(/SET "permissions" = ARRAY\[([^\]]+)\]/)?.[1];
  assert.ok(sql);
  assert.deepEqual([...sql.matchAll(/'([^']+)'/g)].map(item => item[1]), grants);
  const assignment = [{ facilityId: "midpoint", role: { name: "Facility manager", permissions: grants } }];
  for (const permission of ["operations.view", "operations.manage", "billing.view", "billing.schedule.manage", "billing.documents.send", "ledger.view", "reservation_prices.propose", "reports.financial", "payments.view", "payments.manage", "collections.view", "collections.manage", "collections.policy", "collections.export"]) {
    assert.equal(currentRoleAccess(assignment, permission, "midpoint").allowed, true);
    assert.equal(currentRoleAccess(assignment, permission, "other").allowed, false);
  }
  for (const permission of ["billing.manage", "configuration.manage", "users.manage", "data.personal_export", "access.manage", "payments.refund_reserve"]) assert.equal(currentRoleAccess(assignment, permission, "midpoint").allowed, false);
});
