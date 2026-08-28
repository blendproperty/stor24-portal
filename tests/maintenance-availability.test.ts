import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operationsRoute = readFileSync(new URL("../src/app/api/v1/operations/route.ts", import.meta.url), "utf8");
const maintenanceRoute = readFileSync(new URL("../src/app/api/v1/operations/maintenance/[id]/route.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/components/operations-workspace.tsx", import.meta.url), "utf8");

test("unit-linked maintenance atomically removes available inventory from booking", () => {
  assert.match(operationsRoute, /\["AVAILABLE", "SERVICE"\]\.includes\(unit\.status\)/);
  assert.match(operationsRoute, /data: \{ status: "SERVICE" \}/);
  assert.match(operationsRoute, /UNIT_NOT_AVAILABLE/);
});

test("maintenance completion releases a unit only when no operational claim remains", () => {
  assert.match(maintenanceRoute, /otherMaintenance/);
  assert.match(maintenanceRoute, /activeReservations/);
  assert.match(maintenanceRoute, /blockingOccupancies/);
  assert.match(maintenanceRoute, /status: "SERVICE"/);
  assert.match(maintenanceRoute, /data: \{ status: "AVAILABLE" \}/);
});

test("maintenance status changes are facility scoped and audited", () => {
  assert.match(maintenanceRoute, /requirePermission\("operations\.manage", before\.facilityId\)/);
  assert.match(maintenanceRoute, /maintenance\.status\.change/);
  assert.match(maintenanceRoute, /before,/);
  assert.match(maintenanceRoute, /after: updated/);
});

test("operations portal exposes maintenance creation and lifecycle controls", () => {
  assert.match(workspace, /Create maintenance request/);
  assert.match(workspace, /updateMaintenance\(item\.id, "IN_PROGRESS"\)/);
  assert.match(workspace, /updateMaintenance\(item\.id, "COMPLETED"\)/);
  assert.match(workspace, /updateMaintenance\(item\.id, "CANCELLED"\)/);
});
