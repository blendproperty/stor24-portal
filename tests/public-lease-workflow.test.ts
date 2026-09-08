import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LEASE_CLAUSE_KEYS, LEASE_VERSION, renderLeaseDocument } from "../src/lib/lease-agreement-content";

test("reservation lease snapshots the exact version and customer terms", () => {
  const content = renderLeaseDocument({ facilityName: "Store 1 — Midpoint", unitNumber: "169", unitTypeName: "FF-B6", customerName: "Brett Dovey", monthlyRate: 1000, startDate: new Date("2026-09-09T00:00:00.000Z") });
  assert.match(content, new RegExp(LEASE_VERSION));
  assert.match(content, /Brett Dovey/);
  assert.match(content, /Unit: 169 \(FF-B6\)/);
  assert.equal(LEASE_CLAUSE_KEYS.length, 7);
});

test("public reservation signing is authenticated, audited and does not activate tenancy or access", async () => {
  const route = await readFile("src/app/api/public/v1/lease-signing/reservation/[token]/route.ts", "utf8");
  const service = await readFile("src/lib/public-lease-workflow.ts", "utf8");
  assert.match(route, /publicApiAuthorized/);
  assert.match(route, /rateLimit/);
  assert.match(service, /public_lease\.signed/);
  assert.match(service, /sha256/);
  assert.doesNotMatch(service, /occupancy\.update/);
  assert.doesNotMatch(service, /tenancy\.update/);
  assert.doesNotMatch(service, /ledgerEntry\.create/);
});

test("the new Netcash endpoint fails closed until the reservation lease is signed", async () => {
  const route = await readFile("src/app/api/public/v1/payments/netcash/start-signed/route.ts", "utf8");
  assert.match(route, /publicReservationHasSignedLease/);
  assert.match(route, /LEASE_SIGNATURE_REQUIRED/);
  assert.match(route, /startPublicNetcashSandboxPayment/);
  assert.ok(route.indexOf("publicReservationHasSignedLease") < route.lastIndexOf("startPublicNetcashSandboxPayment"));
});
