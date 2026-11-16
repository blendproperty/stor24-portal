import assert from "node:assert/strict";
import test from "node:test";
import { jobCardManagerRouteAllowed, MIDPOINT_JOB_CARD_PERMISSION, validMidpointJobCardRole } from "../src/lib/maintenance-job-policy";
import { canVisit } from "../src/lib/navigation-access";

test("Carlo only gets Midpoint cards and personal security settings", () => {
  const access = { owner: false, permissions: [MIDPOINT_JOB_CARD_PERMISSION] };
  assert.equal(canVisit("/operations/job-cards", access), true);
  assert.equal(canVisit("/operations", access), false);
  assert.equal(jobCardManagerRouteAllowed("/api/v1/operations/job-cards", "GET"), true);
  assert.equal(jobCardManagerRouteAllowed("/api/v1/operations/job-cards", "POST"), false);
  assert.equal(jobCardManagerRouteAllowed("/api/v1/operations/maintenance/job", "PATCH"), true);
  for (const path of ["/", "/tenants", "/api/v1/operations", "/api/v1/operations/forms", "/api/v1/reports", "/api/v1/payments"]) {
    assert.equal(jobCardManagerRouteAllowed(path, "GET"), false);
  }
  assert.equal(jobCardManagerRouteAllowed("/operations/job-cards/settings", "GET"), true);
  assert.equal(validMidpointJobCardRole("carlo@blendproperty.co.za", access.permissions, { name: "Store 1 - Midpoint", active: false }), false);
  assert.equal(validMidpointJobCardRole("carlo@blendproperty.co.za", [...access.permissions, "operations.view"], { name: "Store 1 - Midpoint", active: true }), false);
});
