import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LEASE_CLAUSE_KEYS, LEASE_VERSION, renderLeaseDocument } from "../src/lib/lease-agreement-content";
import { renderSignedLeasePdf } from "../src/lib/public-lease-pdf";

test("reservation lease snapshots the exact version and customer terms", () => {
  const content = renderLeaseDocument({ facilityName: "Store 1 — Midpoint", unitNumber: "169", unitTypeName: "FF-B6", customerName: "Brett Dovey", monthlyRate: 1000, startDate: new Date("2026-09-09T00:00:00.000Z"), paymentMethod: "DEBIT_ORDER" });
  assert.match(content, new RegExp(LEASE_VERSION));
  assert.match(content, /Brett Dovey/);
  assert.match(content, /Unit: 169 \(FF-B6\)/);
  assert.match(content, /debit order/i);
  assert.equal(LEASE_CLAUSE_KEYS.length, 8);
});

test("a completed reservation agreement produces a downloadable PDF artifact", async () => {
  const pdf = await renderSignedLeasePdf({
    content: "STOR24 STORAGE AGREEMENT\nCustomer: Brett Dovey\nPayment method: DEBIT ORDER",
    reference: "ST24-TEST-PDF",
    paymentMethod: "DEBIT_ORDER",
    signerName: "Brett Dovey",
    signedAt: new Date("2026-09-08T12:00:00.000Z"),
    sha256: "a".repeat(64),
  });
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("ascii"), "%PDF-");
  assert.ok(pdf.byteLength > 1_000);
});

test("public reservation signing is authenticated, audited and does not activate tenancy or access", async () => {
  const route = await readFile("src/app/api/public/v1/lease-signing/reservation/[token]/route.ts", "utf8");
  const service = await readFile("src/lib/public-lease-workflow.ts", "utf8");
  assert.match(route, /publicApiAuthorized/);
  assert.match(route, /rateLimit/);
  assert.match(service, /public_lease\.signed/);
  assert.match(service, /sha256/);
  assert.match(service, /signedPdfSha256/);
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
