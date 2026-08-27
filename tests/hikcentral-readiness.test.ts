import assert from "node:assert/strict";
import test from "node:test";

import { hikCentralReadiness } from "../src/lib/integrations/hikcentral-readiness";

const configured = {
  company: { endpoint: "https://hikcentral.example.co.za", appKeyConfigured: true, appSecretConfigured: true, status: "CONFIGURED" as const, failureMessage: null },
  facilities: [{ name: "Midpoint", organisationIndexCode: "org-1", doorIndexCodes: ["door-1"], status: "CONFIGURED" as const, failureMessage: null }],
};

test("HikCentral requires all credential fields before it can be ready to test", () => {
  const result = hikCentralReadiness({ ...configured, company: { ...configured.company, appSecretConfigured: false } });
  assert.equal(result.state, "Configuration required");
  assert.match(result.detail, /App Secret/);
});

test("HikCentral requires a facility organisation and door mapping", () => {
  const result = hikCentralReadiness({ ...configured, facilities: [{ ...configured.facilities[0], doorIndexCodes: [] }] });
  assert.equal(result.state, "Configuration required");
  assert.match(result.detail, /door index code/);
});

test("HikCentral is ready to test only after credentials and mappings exist", () => {
  assert.equal(hikCentralReadiness(configured).state, "Ready to test");
});

test("HikCentral exposes a failed live test", () => {
  const result = hikCentralReadiness({ ...configured, facilities: [{ ...configured.facilities[0], status: "DEGRADED", failureMessage: "HikCentral rejected the signed request." }] });
  assert.equal(result.state, "Connection failed");
  assert.equal(result.detail, "HikCentral rejected the signed request.");
});

test("HikCentral is connected only with company and facility success", () => {
  const result = hikCentralReadiness({ company: { ...configured.company, status: "CONNECTED" }, facilities: [{ ...configured.facilities[0], status: "CONNECTED" }] });
  assert.equal(result.state, "Connected");
  assert.equal(result.detail, "1 facility connection verified");
});
