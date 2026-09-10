import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { db } from "../src/lib/db";
import { startHostedMandate, hostedMandateStatus } from "../src/lib/public-hosted-mandate";
import { POST as providerReturn } from "../src/app/api/webhooks/netcash/mandate/route";
function stub(target: object, name: string, replacement: () => Promise<unknown>) {
  const original = Reflect.get(target, name); let calls = 0;
  const fn = async () => { calls++; return replacement(); };
  Reflect.set(target, name, fn); assert.equal(Reflect.get(target, name), fn);
  return { mock: { restore: () => { Reflect.set(target, name, original); }, callCount: () => calls } };
}

test("disabled mandate setup never invokes the provider", async () => {
  const enabled = process.env.NETCASH_MANDATE_SETUP_ENABLED;
  delete process.env.NETCASH_MANDATE_SETUP_ENABLED;
  const lookup = stub(db.publicReservationLease, "findUnique", async () => ({ status: "SIGNED", paymentMethod: "DEBIT_ORDER", expiresAt: new Date(Date.now() + 60000), reservation: { status: "ACTIVE", customer: { organisationId: "test-org" } }, mandate: null }));
  const network = mock.method(globalThis, "fetch", async () => { throw new Error("UNEXPECTED_NETWORK"); });
  try {
    assert.equal((await hostedMandateStatus("fake-token")).enabled, false);
    await assert.rejects(startHostedMandate("fake-token"), /MANDATE_CONFIGURATION_REQUIRED/);
    assert.equal(network.mock.callCount(), 0);
  } finally { lookup.mock.restore(); network.mock.restore(); if (enabled === undefined) delete process.env.NETCASH_MANDATE_SETUP_ENABLED; else process.env.NETCASH_MANDATE_SETUP_ENABLED = enabled; }
});
test("unsigned agreements cannot start or inspect a mandate", async () => {
  const lookup = stub(db.publicReservationLease, "findUnique", async () => ({ status: "READY", paymentMethod: "DEBIT_ORDER" }));
  try { await assert.rejects(startHostedMandate("fake"), /MANDATE_BOOKING_UNAVAILABLE/); await assert.rejects(hostedMandateStatus("fake"), /MANDATE_BOOKING_UNAVAILABLE/); }
  finally { lookup.mock.restore(); }
});
test("browser return cannot mark a mandate signed or store posted banking data", async () => {
  const correlation = "test-correlation-not-a-real-token-0001";
  const lookup = stub(db.publicDebitMandate, "findUnique", async () => ({ correlation, lease: { signingToken: "test-signing-token" } }));
  const write = stub(db.publicDebitMandate, "update", async () => { throw new Error("UNEXPECTED_WRITE"); });
  const network = mock.method(globalThis, "fetch", async () => { throw new Error("UNEXPECTED_NETWORK"); });
  try {
    const response = await providerReturn(new Request("https://crm.example/api/webhooks/netcash/mandate", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ AccountRef: "ST24-test", Field1: correlation, MandateSuccessful: "1", BankAccountNo: "FAKE_BANK_DATA", MandatePDFLink: "https://evil.example/key" }) }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://stor4.srv938083.hstgr.cloud/book/debit-order/test-signing-token");
    assert.equal(write.mock.callCount(), 0); assert.equal(network.mock.callCount(), 0);
    assert.equal(await response.text(), "");
  } finally { lookup.mock.restore(); write.mock.restore(); network.mock.restore(); }
});
test("unmatched browser returns do not disclose booking tokens", async () => {
  const lookup = stub(db.publicDebitMandate, "findUnique", async () => ({ correlation: "real-correlation-not-matching-0001", lease: { signingToken: "do-not-disclose" } }));
  try {
    const response = await providerReturn(new Request("https://crm.example/api/webhooks/netcash/mandate", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ AccountRef: "ST24-test", Field1: "wrong-correlation-not-matching-0001" }) }));
    assert.equal(response.status, 400); assert.equal(response.headers.get("location"), null);
  } finally { lookup.mock.restore(); }
});
