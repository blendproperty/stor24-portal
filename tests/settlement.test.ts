import test from "node:test";
import assert from "node:assert/strict";
import { amount, units, parseDailyStatement, parseBankCsv } from "../src/lib/settlement-policy";
import { requestDailyStatement, retrieveDailyStatement, merchantIdentity } from "../src/lib/payments/netcash-statement";
import { reconcileNetcashPayment } from "../src/lib/payments/netcash-reconciliation";
test("internal payment view keeps test and corrected outcomes distinct and never matches null references", () => {
  const p = { id: "payment", status: "SUCCEEDED", amount: 100, providerRef: null };
  assert.equal(reconcileNetcashPayment({ ...p, environment: "sandbox" }, []).state, "TEST");
  assert.equal(reconcileNetcashPayment({ ...p, status: "REFUNDED" }, []).state, "CORRECTED");
  assert.equal(reconcileNetcashPayment(p, [{ id: "unrelated", type: "PAYMENT", amount: 100, externalRef: null, metadata: null }]).state, "MISSING_LEDGER");
});
const row = (code: string, id: number, value: string, sign = "+") => `20260101\t${code}\t${id}\tCI description\t${value}\t${sign}\t0`;
test("daily statement conserves signed four-decimal movements without double-counting VAT", () => {
  const raw = [row("OBL", 0, "-5.1250"), row("PNC", 1, "100"), row("NSF", 2, "1.0001", "-").replace(/0$/, "0.1304"), row("BTR", 3, "90", "-"), row("CBL", 0, "3.8749")].join("\r\n");
  const s = parseDailyStatement(raw, "2026-01-01");
  assert.equal(s.closing, "3.8749"); assert.deepEqual(s.lines.map(l => l.kind), ["RECEIPT", "FEE", "PAYOUT"]);
  assert.equal(s.lines[1].vat, "0.1304"); assert.equal(amount(units("-999999999999.9999")), "-999999999999.9999");
});
test("statement rejects partial, inconsistent, duplicate, wrong-date and wrong-direction sources", () => {
  const good = [row("OBL", 0, "0"), row("PNC", 1, "10"), row("CBL", 0, "10")];
  for (const rows of [good.slice(1), [good[0], good[1], row("CBL", 0, "11")], [good[0], good[1], good[1], row("CBL", 0, "20")], [good[0], row("PNC", 1, "10", "-"), row("CBL", 0, "-10")], good.map(r => r.replace("20260101", "20260102")), [...good, "junk"]]) assert.throws(() => parseDailyStatement(rows.join("\n"), "2026-01-01"));
  assert.throws(() => units("1.00001")); assert.throws(() => units("1e2"));
});
test("bank CSV preserves stable IDs and quoted references; rejects ambiguous values and duplicate rows", () => {
  const header = "transaction_id,date,amount,reference\n";
  const r = parseBankCsv(header + 'BANK-1,2026-01-02,90.0000,"Netcash, payout"\n');
  assert.equal(r[0].reference, "Netcash, payout");
  for (const text of ["BANK-1,2026-01-02,0,Zero", "BANK-1,2026-02-30,1,Bad date", 'BANK-1,2026-01-02,"1,000",Bad amount', 'BANK-1,2026-01-02,1,"a"junk', "BANK-1,2026-01-02,1,a\nBANK-1,2026-01-02,2,b"]) assert.throws(() => parseBankCsv(header + text));
});
const key = "11111111-2222-3333-4444-555555555555";
const envelope = (method: string, result: string) => new Response(`<s:Envelope><s:Body><${method}Response><${method}Result>${result}</${method}Result></${method}Response></s:Body></s:Envelope>`);
test("Netcash daily SOAP uses Account key, exact parameter order and bounded read-only endpoint", async () => {
  const mock: typeof fetch = async (url, init) => {
    assert.match(String(url), /NIWS_NIF.svc$/); assert.equal(init?.redirect, "error");
    assert.match(String(init?.body), /<ServiceKey>[^<]+<\/ServiceKey><FromActionDate>20260101<\/FromActionDate>/);
    assert.equal((init?.headers as Record<string,string>).SOAPAction, '"http://tempuri.org/INIWS_NIF/RequestMerchantStatement"');
    return envelope("RequestMerchantStatement", "636682464000000000");
  };
  assert.equal(await requestDailyStatement(key, "2026-01-01", mock), "636682464000000000");
  assert.equal(await retrieveDailyStatement(key, "636682464000000000", async () => envelope("RetrieveMerchantStatement", "FILE NOT READY")), null);
  assert.equal(await retrieveDailyStatement(key, "636682464000000000", async () => envelope("RetrieveMerchantStatement", "a&#9;b&amp;c")), "a\tb&c");
});
test("provider errors, XML entities, invalid tokens and duplicate results fail closed", async () => {
  for (const response of ["100", "101", "102", "200", "not-a-token"]) await assert.rejects(requestDailyStatement(key, "2026-01-01", async () => envelope("RequestMerchantStatement", response)));
  for (const xml of ["<!DOCTYPE x><RequestMerchantStatementResult>636682464000000000</RequestMerchantStatementResult>", "<Fault>bad</Fault>", "<RequestMerchantStatementResult>636682464000000000</RequestMerchantStatementResult>".repeat(2)]) await assert.rejects(requestDailyStatement(key, "2026-01-01", async () => new Response(xml)));
  await assert.rejects(requestDailyStatement("bad", "2026-01-01", async () => { throw new Error("Must not call"); }), /CONFIG/);
  await assert.rejects(retrieveDailyStatement(key, "../x"), /PROVIDER/);
  assert.notEqual(merchantIdentity("a", "live", "50000000000"), merchantIdentity("a", "sandbox", "50000000000"));
});
