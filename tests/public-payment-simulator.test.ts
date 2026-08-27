import assert from "node:assert/strict";
import test from "node:test";
import { publicPaymentSimulatorEnabled } from "../src/lib/public-payment-simulator";

test("public payment simulator is fail-closed", () => {
  assert.equal(publicPaymentSimulatorEnabled(undefined), false);
  assert.equal(publicPaymentSimulatorEnabled("false"), false);
  assert.equal(publicPaymentSimulatorEnabled("TRUE"), true);
});

test("simulator implementation never writes to the real payment ledger", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/public-payment-simulator.ts", "utf8"));
  assert.doesNotMatch(source, /\b(payment|ledgerEntry)\.create\s*\(/);
  assert.match(source, /STOR24_SIMULATOR|simulated: true/);
});

test("simulated success prepares a UAT lease and customer follow-up without a charge", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile("src/lib/public-payment-follow-up.ts", "utf8");
  assert.match(source, /initialCharge: 0/);
  assert.match(source, /simulation: true/);
  assert.match(source, /PAYMENT_RECEIVED/);
  assert.match(source, /sendLeaseSigningLink/);
  assert.match(source, /FOLLOW_UP_EVIDENCE_MISSING/);
  assert.match(source, /lease-sign:\$\{result\.document\.id\}/);
  assert.match(source, /sim-payment:\$\{session\.id\}:WHATSAPP/);
  assert.doesNotMatch(source, /\b(payment|ledgerEntry)\.create\s*\(/);
});

test("UAT lease signatures cannot activate a real tenancy or occupy a unit", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/leasing-service.ts", "utf8"));
  const guard = source.indexOf('document.type === "LEASE_AGREEMENT_UAT"');
  const activation = source.indexOf('data: { status: "OCCUPIED" }', guard);
  const guardReturn = source.indexOf("return { tenancyId: document.tenancyId, idempotent: false, simulation: true }", guard);
  assert.ok(guard >= 0 && guardReturn > guard);
  assert.ok(activation === -1 || guardReturn < activation);
});
