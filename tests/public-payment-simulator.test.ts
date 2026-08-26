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
