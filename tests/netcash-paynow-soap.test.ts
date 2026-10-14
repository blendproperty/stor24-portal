import assert from "node:assert/strict";
import test from "node:test";
import { createPayNowInvoiceRequest, deletePayNowSubscription, invoiceRequestFields, requestPayNowRefund, subscriptionChangeFields, updatePayNowSubscription } from "../src/lib/payments/netcash-paynow-soap";

const key = "00000000-0000-0000-0000-000000000001";
const vendor = "00000000-0000-0000-0000-000000000002";
const change = { originalReference: "SYNTHETIC-101", cycles: 12, startDate: "2026-11-01", monthlyAmount: "950.00", active: true };
const response = (method: string, value: string) => new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${method}Response xmlns="http://tempuri.org/"><${method}Result>${value}</${method}Result></${method}Response></s:Body></s:Envelope>`);

test("subscription update uses live WSDL order, compact calendar date and literal boolean; tokens are not required", async () => {
  const fields = subscriptionChangeFields(key, change);
  assert.deepEqual(fields.map(([name]) => name), ["M1", "P2", "M17", "M18", "M19", "M20", "Active"]);
  assert.deepEqual(fields.find(([name]) => name === "M19"), ["M19", "20261101"]);
  let calls = 0;
  const result = await updatePayNowSubscription(key, change, async (url, init) => {
    calls++;
    assert.equal(url, "https://ws.netcash.co.za/PayNow/PayNow.svc");
    assert.equal((init!.headers as Record<string, string>).SOAPAction, '"http://tempuri.org/IPayNow/UpdateSubscriptions"');
    assert.match(String(init!.body), /<Active>true<\/Active>/);
    assert.equal(init!.redirect, "error");
    return response("UpdateSubscriptions", "000");
  });
  assert.deepEqual(result, { providerAccepted: true });
  assert.equal(calls, 1);
});

test("invalid references, finite cycles, dates, amounts and keys fail before any provider request", () => {
  for (const input of [{ ...change, cycles: 0 }, { ...change, cycles: 1000 }, { ...change, startDate: "2026-02-30" }, { ...change, monthlyAmount: "0.00" }, { ...change, monthlyAmount: "950,00" }, { ...change, originalReference: "other<reference>" }]) assert.throws(() => subscriptionChangeFields(key, input));
  assert.throws(() => subscriptionChangeFields("bad-key", change), /CONFIGURATION_REQUIRED/);
});

test("ambiguous mutation responses are held and never automatically retried or expose provider content", async () => {
  for (const request of [async () => { throw Error("private transport detail"); }, async () => new Response("private response", { status: 500 }), async () => response("UpdateSubscriptions", "200"), async () => response("UpdateSubscriptions", "301"), async () => response("UpdateSubscriptions", "0"), async () => response("UpdateSubscriptions", "<unexpected/>"), async () => response("UpdateSubscriptions", "&#999999999999;")]) {
    let calls = 0;
    await assert.rejects(updatePayNowSubscription(key, change, async () => { calls++; return request(); }), /^Error: PAYNOW_OUTCOME_UNCERTAIN$/);
    assert.equal(calls, 1);
  }
  await assert.rejects(updatePayNowSubscription(key, change, async () => response("UpdateSubscriptions", "311")), /PAYNOW_REJECTED_311/);
});

test("provider payment request is fixed amount without email, SMS, push or implicit subscription template", async () => {
  const input = { reference: "SYNTHETIC-102", description: "Storage & supplies", amount: "950.00", email: "synthetic@example.invalid" };
  const fields = invoiceRequestFields(key, vendor, input);
  for (const name of ["IgnoreAmount", "M12", "M13", "M14", "SendPushNotification"]) assert.deepEqual(fields.find(([field]) => field === name), [name, false]);
  assert.equal(fields.some(([name]) => name === "M27"), false);
  assert.deepEqual(invoiceRequestFields(key, vendor, { ...input, subscriptionTemplateId: 101 }).at(-1), ["M27", 101]);
  const xml = "<PayNowInvoices><Invoice/></PayNowInvoices>";
  assert.equal(await createPayNowInvoiceRequest(key, vendor, input, async (_, init) => {
    assert.match(String(init!.body), /Storage &amp; supplies/);
    return response("CreateInvoice", "&lt;PayNowInvoices&gt;&lt;Invoice/&gt;&lt;/PayNowInvoices&gt;");
  }), xml);
  await assert.rejects(createPayNowInvoiceRequest(key, vendor, { ...input, amount: "0.00" }), /AMOUNT_INVALID/);
  await assert.rejects(createPayNowInvoiceRequest(key, vendor, input, async () => response("CreateInvoice", "301")), /OUTCOME_UNCERTAIN/);
});

test("subscription cancellation and refund use original binding and exact WSDL field names, with acceptance distinct from settlement", async () => {
  assert.deepEqual(await deletePayNowSubscription(key, change.originalReference, async (_, init) => {
    assert.match(String(init!.body), /<P2>SYNTHETIC-101<\/P2>/);
    return response("DeleteSubscription", "000");
  }), { providerAccepted: true });
  assert.deepEqual(await requestPayNowRefund(key, 101, "50.00", async (_, init) => {
    assert.match(String(init!.body), /<TransactionId>101<\/TransactionId><amount>50.00<\/amount>/);
    return response("RequestCreditCardRefund", "000");
  }), { providerAccepted: true });
  await assert.rejects(requestPayNowRefund(key, 2147483648, "50.00"), /REFUND_TRANSACTION_INVALID/);
});
