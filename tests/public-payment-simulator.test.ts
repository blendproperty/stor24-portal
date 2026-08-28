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
  assert.doesNotMatch(source, /sendLeaseSigningLink/);
  assert.match(source, /FOLLOW_UP_EVIDENCE_MISSING/);
  assert.match(source, /invitationEvidence/);
  assert.match(source, /sim-payment:\$\{session\.id\}:WHATSAPP/);
  assert.match(source, /allowWhenAutomationDisabled: true/);
  assert.match(source, /signingUrl = signer\.signingUrl/);
  assert.match(source, /resendBlendSignInvitation/);
  assert.match(source, /public_payment\.blendsign_invitation_sent/);
  assert.match(source, /single authoritative lease-email channel/);
  assert.doesNotMatch(source, /\b(payment|ledgerEntry)\.create\s*\(/);
  assert.doesNotMatch(source, /paymentMethod:\s*"CARD"/);
  assert.match(source, /session\.paymentMethod/);
});

test("Stor24 owner contact uses the BlendSign template mobile key", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile("src/lib/blendsign-client.ts", "utf8");
  assert.match(source, /data\["owner\.mobile"\] = owner\.phone/);
  assert.doesNotMatch(source, /data\["owner\.phone"\]/);
});

test("the hosted payment choice is required before completion", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/app/api/public/v1/payments/simulated/complete/route.ts", "utf8"));
  assert.match(source, /paymentMethod: z\.enum\(\["DEBIT_ORDER", "CARD", "EFT"\]\)/);
});

test("UAT lease signatures cannot activate a real tenancy or occupy a unit", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/leasing-service.ts", "utf8"));
  const guard = source.indexOf('document.type === "LEASE_AGREEMENT_UAT"');
  const activation = source.indexOf('data: { status: "OCCUPIED" }', guard);
  const guardReturn = source.indexOf("simulation: true", guard);
  assert.ok(guard >= 0 && guardReturn > guard);
  assert.ok(activation === -1 || guardReturn < activation);
});

test("configured Twilio credentials provide a lease-email fallback", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/email.ts", "utf8"));
  assert.match(source, /TWILIO_ACCOUNT_SID && process\.env\.TWILIO_AUTH_TOKEN/);
  assert.match(source, /return new TwilioEmailProvider\(\)/);
});
