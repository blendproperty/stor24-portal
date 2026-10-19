import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { previewReceiptTraining, receiptTrainingFixture } from "../src/lib/receipt-correction-training-policy";

const org = "ctrainingorganisation00001", store = "ctrainingfacility000000001";
const f = receiptTrainingFixture(org, store);
const input = () => ({ operation: "MOVE" as const, reversesId: null, sourceAccountId: f.accounts[0].id, targetAccountId: f.accounts[1].id, sourceEntryId: f.entryId, amount: "75.25", reason: "Training receipt correction only", evidenceReference: "TRAINING-EVIDENCE", requestKey: randomUUID() });
test("training reuses allocation rules and preserves total balance and receipt", () => {
  const preview = previewReceiptTraining(org, store, input());
  assert.equal(preview.sourceBalanceAfter, "-124.75");
  assert.equal(preview.targetBalanceAfter, "374.75");
  assert.equal(preview.sourceReceiptRemaining, "124.75");
  assert.match(preview.notice, /cannot be approved or posted/);
  assert.equal(preview.source.balance, "-200.00");
});
test("training fixtures are stable and disjoint across organisation/store", () => {
  assert.deepEqual(receiptTrainingFixture(org, store), f);
  assert.notEqual(receiptTrainingFixture(org, "cotherfacility000000000001").accounts[0].id, f.accounts[0].id);
  assert.notEqual(receiptTrainingFixture("cotherorganisation00000001", store).entryId, f.entryId);
});
test("training rejects foreign/live identifiers and invalid receipt amounts", () => {
  assert.throws(() => previewReceiptTraining(org, store, { ...input(), sourceAccountId: "cunknownaccount00000000001" }), /NOT_FOUND/);
  assert.throws(() => previewReceiptTraining(org, store, { ...input(), sourceEntryId: "cunknownentry0000000000001" }), /EXCEEDS_RECEIPT/);
  assert.throws(() => previewReceiptTraining(org, store, { ...input(), amount: "200.01" }), /EXCEEDS_RECEIPT/);
  assert.throws(() => previewReceiptTraining(org, store, { ...input(), amount: "0" }), /AMOUNT/);
  assert.throws(() => previewReceiptTraining(org, store, { ...input(), targetAccountId: f.accounts[0].id }), /SCOPE/);
});
test("changed amount/evidence invalidates training preview; original fixture never changes", () => {
  const original = input(), preview = previewReceiptTraining(org, store, original);
  assert.notEqual(previewReceiptTraining(org, store, { ...original, amount: "100" }).fingerprint, preview.fingerprint);
  assert.notEqual(previewReceiptTraining(org, store, { ...original, evidenceReference: "OTHER-TRAINING" }).fingerprint, preview.fingerprint);
  assert.deepEqual(receiptTrainingFixture(org, store), f);
});
