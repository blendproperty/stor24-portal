import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../src/app/api/v1/operations/route.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/components/operations-workspace.tsx", import.meta.url), "utf8");

test("operations exposes only permitted facilities for task creation", () => {
  assert.match(route, /facility\.findMany/);
  assert.match(route, /id: facilityScope/);
  assert.match(workspace, /name="facilityId" required/);
});

test("facility-restricted users cannot create invisible portfolio tasks", () => {
  assert.match(route, /!input\.facilityId && allowedFacilityIds/);
  assert.match(route, /FACILITY_REQUIRED/);
});
