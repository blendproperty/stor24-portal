import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/lib/dashboard-service.ts", import.meta.url), "utf8");

test("operations home uses live scoped data instead of the synthetic demo module", () => {
  assert.doesNotMatch(page, /demo-data|Scaffold active|Good afternoon, Brett/);
  assert.match(page, /getOperationsHome/);
  assert.match(page, /Database-backed/);
});

test("operations home scopes work queues and activity to permitted facilities", () => {
  assert.match(service, /optionalFacilityScope/);
  assert.match(service, /facility: facilityWhere\(scope\)/);
  assert.match(service, /auditEvent\.findMany/);
});
