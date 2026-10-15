import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertIndependentReceiptReview, assertReceiptDate, receiptAmount, receiptIntakeSchema, receiptReviewActionSchema } from "../src/lib/unidentified-receipt-policy";

test("unidentified review never rounds imported evidence or accepts non-positive or unsupported amounts", () => {
  for (const [source, expected] of [["0001.20", "1.20"], ["0.01", "0.01"], ["100.2300", "100.23"], ["99999999.99", "99999999.99"]]) assert.equal(receiptAmount(source), expected);
  for (const value of ["0", "-1", "1.001", "1.0001", "100000000", "1e2", "NaN", "1,00"]) assert.throws(() => receiptAmount(value), /RECEIPT_REVIEW_AMOUNT/);
});
test("source dates respect actual calendar validity and South African day boundary", () => {
  const boundary = new Date("2026-10-14T22:01:00Z");
  assert.doesNotThrow(() => assertReceiptDate("2026-10-15", boundary));
  assert.throws(() => assertReceiptDate("2026-10-16", boundary), /RECEIPT_REVIEW_DATE/);
  assert.throws(() => assertReceiptDate("2026-02-30", boundary), /RECEIPT_REVIEW_DATE/);
});
test("matching review excludes both contributors and cannot be a posting command", () => {
  assert.throws(() => assertIndependentReceiptReview("capturer", "proposer", "capturer"), /INDEPENDENT/);
  assert.throws(() => assertIndependentReceiptReview("capturer", "proposer", "proposer"), /INDEPENDENT/);
  assert.doesNotThrow(() => assertIndependentReceiptReview("capturer", "proposer", "reviewer"));
  const review = { action: "review", id: "intake", facilityId: "store", revision: 2, proposalId: "proposal", decision: "REVIEWED", reference: "review-ticket", confirmed: true };
  assert.equal(receiptReviewActionSchema.safeParse(review).success, true);
  for (const changed of [{ confirmed: false }, { action: "post" }, { decision: "POSTED" }, { execute: true }, { revision: -1 }]) assert.equal(receiptReviewActionSchema.safeParse({ ...review, ...changed }).success, false);
});
test("reported and imported evidence stay separate and require source-bound identities", () => {
  const manual = { facilityId: "store", requestKey: randomUUID(), source: { sourceType: "MANUAL_REPORTED", evidenceReference: "bank-note-001", receiptDate: "2026-10-14", amount: "10.20", currency: "ZAR", note: "Investigate original bank credit" } };
  assert.equal(receiptIntakeSchema.safeParse(manual).success, true);
  assert.equal(receiptIntakeSchema.safeParse({ ...manual, source: { ...manual.source, currency: "USD" } }).success, false);
  assert.equal(receiptIntakeSchema.safeParse({ ...manual, source: { ...manual.source, verified: true } }).success, false);
  assert.equal(receiptIntakeSchema.safeParse({ ...manual, source: { sourceType: "NETCASH_STATEMENT_LINE", sourceId: "source", sourceFingerprint: "a".repeat(64) } }).success, true);
  assert.equal(receiptIntakeSchema.safeParse({ ...manual, source: { sourceType: "NETCASH_STATEMENT_LINE", sourceId: "source" } }).success, false);
});
