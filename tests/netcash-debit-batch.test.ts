import assert from "node:assert/strict";
import test from "node:test";
import { buildCompactDebitFile, parseDebitLoadReport, uploadDebitBatch, validDebitDate } from "../src/lib/payments/netcash-debit-batch";
const key = "11111111-2222-3333-4444-555555555555";
test("compact EFT format uses cents, counts rows, rejects duplicate and injected references", () => {
  const file = buildCompactDebitFile(key, key, "ST24-CI", "2028-02-29", [{ reference: "CI001", amount: 1102 }, { reference: "CI002", amount: 2000 }]);
  assert.match(file, /\tCompactTwoDay\tST24-CI\t20280229\t/);
  assert.ok(file.endsWith("K\t101\t162\nT\tCI001\t110200\nT\tCI002\t200000\nF\t2\t310200\t9999"));
  for (const rows of [[{ reference: "CI001\nT", amount: 1 }], [{ reference: "CI001", amount: .001 }], [{ reference: "CI001", amount: -1 }], [{ reference: "CI001", amount: 1 }, { reference: "CI001", amount: 1 }]]) assert.throws(() => buildCompactDebitFile(key, key, "ST24-CI", "2028-02-29", rows), /FILE_INVALID/);
  assert.equal(validDebitDate("2027-02-29"), false); assert.equal(validDebitDate("2028-02-29"), true); assert.equal(validDebitDate("invalid"), false);
});
test("SOAP upload handles real file tokens, safe rejection codes and ambiguous transport failures", async () => {
  const request = (async (_url, init) => { assert.equal(init?.redirect, "error"); assert.match(String(init?.body), /<BatchFileUpload xmlns="http:\/\/tempuri.org\/">/); return new Response("<BatchFileUploadResult>20000000.123456.1.1</BatchFileUploadResult>"); }) as typeof fetch;
  assert.equal(await uploadDebitBatch(key, "CI fixture", request), "20000000.123456.1.1");
  await assert.rejects(uploadDebitBatch(key, "CI", async () => new Response("<BatchFileUploadResult>100</BatchFileUploadResult>")), /UPLOAD_REJECTED_100/);
  await assert.rejects(uploadDebitBatch(key, "CI", async () => new Response("<Fault>sensitive provider detail</Fault>")), /^Error: DEBIT_PROVIDER_OUTCOME_UNKNOWN$/);
  await assert.rejects(uploadDebitBatch(key, "CI", async () => new Response("<BatchFileUploadResult>123.1.1</BatchFileUploadResult><BatchFileUploadResult>321.1.1</BatchFileUploadResult>")), /OUTCOME_UNKNOWN/);
});
test("load report binds exact batch, value and date; partial results never count as payment", () => {
  const report = "###BEGIN\tST24-CI\tSUCCESSFUL\t01:00 PM\t1150.00\t20990214\n###END\t01:01 PM";
  assert.equal(parseDebitLoadReport("FILE NOT READY", "ST24-CI", "2099-02-14", 1150), "SUBMITTED");
  assert.equal(parseDebitLoadReport(report, "ST24-CI", "2099-02-14", 1150), "ACCEPTED");
  assert.equal(parseDebitLoadReport(report, "ST24-CI", "2099-02-15", 1150), "REVIEW_REQUIRED");
  assert.equal(parseDebitLoadReport(report, "ST24-CI", "2099-02-14", 1151), "REVIEW_REQUIRED");
  assert.equal(parseDebitLoadReport(report.replace("SUCCESSFUL", "SUCCESSFUL WITH ERRORS"), "ST24-CI", "2099-02-14", 1150), "REVIEW_REQUIRED");
  assert.equal(parseDebitLoadReport(report.replace("\n###END", "\n###ERROR\tprivate detail\n###END"), "ST24-CI", "2099-02-14", 1150), "REVIEW_REQUIRED");
  assert.throws(() => parseDebitLoadReport(report, "OTHER", "2099-02-14", 1150), /REPORT_INVALID/);
});
