import assert from "node:assert/strict";
import test from "node:test";
import { addHostedMandate, buildAddMandateEnvelope, parseAddMandateResponse, requestMandateData, requestMandatePdf, retrieveMandatePdf, boundedBody, safeMandateUrl, verifyMandateReport, type MandateTerms } from "../src/lib/payments/netcash-mandate";
import { mandatePolicy } from "../src/lib/payments/netcash-mandate-policy";

const terms: MandateTerms = { reference: "ST24-test-mandate", agreementReference: "ST24-test-agreement", agreementDate: "20260910", firstName: "Test & Sample", surname: "Person", phone: "0825551234", email: "test@example.com", amount: "1000.00", commencementMonth: 10, debitDay: 1, noticeDays: 30, holiday: "VeryNextOrdinaryBusinessDay", correlation: "test-correlation-not-a-real-token-0001" };
function report(status = "6") {
  const r = Array<string>(43).fill("");
  Object.assign(r, { 0: status, 1: terms.reference, 3: "1000.0000", 11: "1", 12: "10", 13: "01", 14: "20260910", 15: terms.agreementReference, 16: "30", 17: "1", 21: "1", 30: terms.correlation, 40: "0" });
  return `###BEGIN\t20260910\n${r.join("\t")}\n###END`;
}
test("AddMandate uses the verified SOAP sequence and never sends bank data or activates collections", () => {
  const xml = buildAddMandateEnvelope("test-service-key", terms);
  assert.match(xml, /schemas.xmlsoap.org\/soap\/envelope/);
  assert.match(xml, /<ServiceKey>test-service-key<\/ServiceKey><AccountReference>/);
  assert.match(xml, /Test &amp; Sample/);
  assert.match(xml, /<MandateAmount>1000.00<\/MandateAmount>/);
  for (const key of ["MandateActive", "RequestAVS", "IncludeDebiCheck", "AddToMasterFile", "AllowVariableDebitAmounts"]) assert.match(xml, new RegExp(`<${key}>false</${key}>`));
  for (const key of ["BankAccountNumber", "BankDetailType", "BranchCode", "CreditCardToken"]) assert.ok(!xml.includes(`<${key}>`));
});
test("invalid amounts, dates, contact details and commercial options fail before any call", () => {
  for (const patch of [{ amount: "0.00" }, { amount: "1000" }, { debitDay: 32 }, { noticeDays: 0 }, { commencementMonth: 13 }, { phone: "bad" }, { correlation: "guessable" }, { holiday: "guess" }]) {
    assert.throws(() => buildAddMandateEnvelope("test", { ...terms, ...patch } as MandateTerms), /MANDATE_TERMS_INVALID/);
  }
});
test("provider errors and unexpected URL hosts fail closed without echoing provider PII", () => {
  assert.equal(parseAddMandateResponse('<r><b:ErrorCode>000</b:ErrorCode><b:MandateUrl>https://short.surf/test</b:MandateUrl></r>'), "https://short.surf/test");
  assert.throws(() => parseAddMandateResponse('<r><ErrorCode>100</ErrorCode><Errors>secret</Errors></r>'), /^Error: MANDATE_PROVIDER_100$/);
  for (const url of ["http://short.surf/test", "https://short.surf.evil.test/test", "https://user@short.surf/test", "https://localhost/test", "javascript:alert(1)"]) assert.throws(() => safeMandateUrl(url));
  assert.throws(() => parseAddMandateResponse('<!DOCTYPE x><r><ErrorCode>000</ErrorCode></r>'));
  assert.throws(() => parseAddMandateResponse('<r><ErrorCode>000</ErrorCode><ErrorCode>100</ErrorCode></r>'));
});
test("transport uses SOAP 1.1 action, no redirects, bounded timeout and one request only", async () => {
  let calls = 0;
  const url = await addHostedMandate("test", terms, async (url, options) => {
    calls++; assert.equal(String(url), "https://ws.netcash.co.za/NIWS/NIWS_NIF.svc");
    assert.equal(options?.redirect, "error"); assert.ok(options?.signal);
    assert.equal((options?.headers as Record<string, string>).SOAPAction, '"http://tempuri.org/INIWS_NIF/AddMandate"');
    return new Response('<r><ErrorCode>000</ErrorCode><MandateUrl>https://short.surf/test</MandateUrl></r>');
  });
  assert.equal(url, "https://short.surf/test"); assert.equal(calls, 1);
});
test("authenticated report must bind the reference, amount, agreement, schedule and nonce", () => {
  assert.equal(verifyMandateReport(report(), terms), "SIGNED");
  for (const field of ["correlation", "agreementReference", "amount", "agreementDate", "debitDay", "noticeDays", "holiday"]) {
    const patch = { ...terms, [field]: typeof terms[field as keyof MandateTerms] === "number" ? 2 : "different" };
    assert.equal(verifyMandateReport(report(), patch as MandateTerms), "REVIEW_REQUIRED");
  }
  assert.equal(verifyMandateReport(report(), { ...terms, reference: "other" }), "AWAITING_SIGNATURE");
});
test("declined, expired, changed and unverified records cannot become signed", () => {
  assert.equal(verifyMandateReport(report("5"), terms), "DECLINED");
  assert.equal(verifyMandateReport(report("3"), terms), "EXPIRED");
  assert.equal(verifyMandateReport(report("7"), terms), "REVIEW_REQUIRED");
  assert.equal(verifyMandateReport(report("10"), terms), "AWAITING_SIGNATURE");
  assert.equal(verifyMandateReport(report("9"), terms), "AWAITING_SIGNATURE");
});
test("incomplete or duplicate account rows never confirm signature", () => {
  assert.throws(() => verifyMandateReport("200", terms), /MANDATE_REPORT_PENDING/);
  const row = report().split("\n")[1];
  assert.throws(() => verifyMandateReport(`###BEGIN\t20260910\n${row}\n${row}\n###END`, terms), /AMBIGUOUS/);
});
test("report request rejects service errors instead of treating them as file tokens", async () => {
  assert.equal(await requestMandateData("test", async () => new Response('<r><RequestMandateDataResult>12345.123456.123456789012345678</RequestMandateDataResult></r>')), "12345.123456.123456789012345678");
  assert.equal(await requestMandateData("test", async () => new Response('<r><RequestMandateDataResult>20000000.2550236530.0483.2.2</RequestMandateDataResult></r>')), "20000000.2550236530.0483.2.2");
  await assert.rejects(requestMandateData("test", async () => new Response('<r><RequestMandateDataResult>100</RequestMandateDataResult></r>')), /UNAVAILABLE/);
});
test("mandate policy fails closed unless every approved commercial setting is supplied", () => {
  assert.equal(mandatePolicy({}), null);
  assert.equal(mandatePolicy({ NETCASH_MANDATE_SETUP_ENABLED: "true" }), null);
  const p = { organisationId: "test-org", approvedBy: "Test approver", noticeDays: 30, holiday: "VeryNextOrdinaryBusinessDay", allowedDays: [1, 15, 25], recurringAmountBasis: "SIGNED_MONTHLY_RENT_ONLY", firstPaymentHandling: "SEPARATE_APPROVED_PAYMENT", postbackConfigured: true };
  assert.ok(mandatePolicy({ NETCASH_MANDATE_SETUP_ENABLED: "true", NETCASH_MANDATE_POLICY: JSON.stringify(p) }));
  assert.equal(mandatePolicy({ NETCASH_MANDATE_SETUP_ENABLED: "true", NETCASH_MANDATE_POLICY: JSON.stringify({ ...p, postbackConfigured: false }) }), null);
});
test("PDF retrieval binds exact account reference and never downloads from an untrusted host", async () => {
  const key = "00000000-0000-0000-0000-000000000000";
  let downloads = 0;
  const fake: typeof fetch = async (_url, options) => {
    const action = (options?.headers as Record<string, string> | undefined)?.SOAPAction ?? "";
    if (action.includes("BatchFileUpload")) {
      assert.match(String(options?.body), /RequestMandatePDF/); assert.doesNotMatch(String(options?.body), /SameDay|TwoDay|MandateToMasterfile/);
      return new Response('<r><BatchFileUploadResult>20000000.1.2.3.4</BatchFileUploadResult></r>');
    }
    if (action.includes("RequestFileUploadReport")) return new Response(`<r><RequestFileUploadReportResult>###BEGIN\t${terms.reference}\tSUCCESSFUL\t12:00\n###END\t12:00</RequestFileUploadReportResult></r>`);
    if (action.includes("RetrieveMandatePDF")) return new Response(`<r><RetrieveMandatePDFResult>###BEGIN\t${terms.reference}\n${terms.reference}\thttps://short.surf/pdf-test\n###END</RetrieveMandatePDFResult></r>`);
    downloads++; assert.equal(new URL(String(_url)).searchParams.get("PKey"), key);
    assert.equal(options?.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
  };
  const token = await requestMandatePdf(key, terms.reference, key, "20260910", fake);
  await assert.rejects(retrieveMandatePdf(key, token, terms.reference, fake), /MANDATE_URL_INVALID/);
  assert.equal(downloads, 1);
});
test("oversized provider bodies are rejected", async () => {
  await assert.rejects(boundedBody(new Response("123456"), 5), /TOO_LARGE/);
});
