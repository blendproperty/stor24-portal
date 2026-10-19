import assert from "node:assert/strict";
import test from "node:test";
import { debitResultEvidenceSchema, reconcileDebitFailure, type DebitResultEvidence } from "../src/lib/arrears-debit-evidence";
import { arrearsAccessReview } from "../src/lib/arrears-access-review-policy";

const debt = { organisationId: "org", facilityId: "store", merchantId: "merchant", connectionId: "connection", accountId: "account", originalChargeId: "charge", invoiceId: "invoice", amountCents: 60000 };
const instruction = { ...debt, mandateId: "mandate", batchId: "batch", instructionId: "instruction", customerReference: "reference", actionDate: "2026-10-09", currency: "ZAR" as const };
const unpaid: DebitResultEvidence = { ...instruction, eventId: "unpaid", rawEvidenceSha256: "a".repeat(64), sourceAt: "2026-10-11T23:15:00+02:00", observedAt: "2026-10-12T06:00:00Z", outcome: "FINAL_UNPAID", failure: { precision: "INSTANT", value: "2026-10-10T22:30:00Z" }, reason: "Provider-confirmed unpaid" };
const run = (results: unknown[] = [unpaid], instructions: unknown[] = [instruction], asOf = "2026-10-18") => reconcileDebitFailure({ debt, instructions, results, asOf });
const result = (patch: Partial<DebitResultEvidence>): DebitResultEvidence => ({ ...unpaid, ...patch });

test("confirmed provider time uses SAST calendar date, not retrieval/due date", () => {
  const r = run();
  assert.equal(r.firstFailure?.day, "2026-10-11");
  assert.equal(r.firstFailure?.precision, "INSTANT");
  assert.equal(r.reviewOn, "2026-10-18");
  assert.equal(r.reviewDateReached, true);
  assert.equal(run([unpaid], [instruction], "2026-10-17").reviewDateReached, false);
  assert.equal(r.accessApproval, false); assert.equal(r.financialApproval, false);
});

test("day precision is retained without inventing midnight failure time; leap/year rollover", () => {
  const leapInstruction = { ...instruction, actionDate: "2028-02-28" };
  const leap = { ...unpaid, ...leapInstruction, failure: { precision: "DAY", value: "2028-02-28" }, sourceAt: "2028-02-29T10:00:00Z", observedAt: "2028-02-29T10:01:00Z" };
  const r = run([leap], [leapInstruction], "2028-03-06");
  assert.equal(r.firstFailure?.value, "2028-02-28"); assert.equal(r.reviewOn, "2028-03-06");
  const yearInstruction = { ...instruction, actionDate: "2026-12-31" };
  assert.equal(run([{ ...unpaid, ...yearInstruction, failure: { precision: "DAY", value: "2026-12-31" }, sourceAt: "2027-01-01T10:00:00Z", observedAt: "2027-01-01T10:01:00Z" }], [yearInstruction], "2027-01-07").reviewOn, "2027-01-07");
});

test("every original identity/amount dimension must bind exactly, not customer reference alone", () => {
  for (const key of Object.keys(instruction) as (keyof typeof instruction)[]) {
    const value = key === "amountCents" ? 59999 : key === "actionDate" ? "2026-10-08" : "different";
    const r = run([{ ...unpaid, [key]: value }]);
    assert.equal(r.reconciled, false, key); assert.equal(r.reviewOn, null, key);
  }
  assert.equal(run([unpaid], [{ ...instruction, originalChargeId: "other" }]).reconciled, false);
  assert.equal(run([unpaid], [{ ...instruction, merchantId: "other" }]).reconciled, false);
});

test("intake rejection, pending, tracking and empty result never start a clock", () => {
  for (const outcome of ["PENDING", "TRACKING", "TECHNICAL_REJECTION"] as const) {
    const r = run([result({ outcome, failure: null })]);
    assert.equal(r.firstFailure, null); assert.equal(r.reviewOn, null); assert.equal(r.reviewDateReached, false);
  }
  assert.equal(run([]).reviewOn, null);
  assert.equal(run([{ ...unpaid, outcome: "ACCEPTED" }]).reviewOn, null);
  assert.equal(run([{ ...unpaid, outcome: "FAILED" }]).reviewOn, null);
});

test("retries retain first failure across instruction and event order; duplicates do not restart", () => {
  const retry = { ...instruction, batchId: "retry-batch", instructionId: "retry", actionDate: "2026-10-14" };
  const later = { ...unpaid, ...retry, eventId: "retry-unpaid", failure: { precision: "DAY", value: "2026-10-15" }, sourceAt: "2026-10-15T10:00:00Z", observedAt: "2026-10-15T10:01:00Z" };
  const forward = run([unpaid, later], [instruction, retry]);
  assert.equal(forward.reviewOn, "2026-10-18");
  assert.deepEqual(run([later, unpaid, { ...unpaid, observedAt: "2026-10-18T10:00:00Z" }], [retry, instruction]), forward);
});

test("pending retry holds review without erasing original clock", () => {
  const retry = { ...instruction, instructionId: "retry", batchId: "retry-batch" };
  const pending = { ...unpaid, ...retry, eventId: "pending", outcome: "PENDING", failure: null };
  const r = run([unpaid, pending], [instruction, retry]);
  assert.equal(r.reviewOn, "2026-10-18"); assert.equal(r.reconciled, false);
  assert.equal(run([unpaid], [instruction, retry]).reconciled, false);
});

test("tracking to final is order-independent; same-time contradictory outcome stays held", () => {
  const tracking = result({ eventId: "tracking", outcome: "TRACKING", failure: null, sourceAt: "2026-10-10T08:00:00Z" });
  assert.equal(run([unpaid, tracking]).reconciled, true);
  assert.equal(run([tracking, unpaid]).reconciled, true);
  assert.equal(run([unpaid, { ...tracking, sourceAt: unpaid.sourceAt }]).reconciled, false);
});

test("conflicting duplicate, failure date or instruction is held rather than overwritten", () => {
  assert.ok(run([unpaid, result({ rawEvidenceSha256: "b".repeat(64) })]).blockers.includes("CONFLICTING_PROVIDER_EVENT"));
  assert.ok(run([unpaid, result({ eventId: "changed-date", failure: { precision: "DAY", value: "2026-10-10" } })]).blockers.includes("CONFLICTING_FAILURE_DATE"));
  assert.ok(run([unpaid], [instruction, { ...instruction, batchId: "other" }]).blockers.includes("CONFLICTING_INSTRUCTION"));
});

test("settlement, dispute and corrections cannot be silently cleared by later unpaid", () => {
  for (const outcome of ["SETTLED", "DISPUTED", "CORRECTION"] as const) {
    const r = run([result({ eventId: outcome, outcome, failure: null, sourceAt: "2026-10-10T08:00:00Z" }), unpaid]);
    assert.equal(r.reviewOn, "2026-10-18"); assert.ok(r.blockers.includes("RECONCILIATION_REQUIRED")); assert.equal(r.reviewDateReached, false);
  }
});

test("invalid dates, non-final failure dates, future/as-of evidence and client approval fields fail closed", () => {
  for (const patch of [{ failure: null }, { observedAt: "2026-10-10T00:00:00Z" }, { failure: { precision: "DAY", value: "2026-10-32" } }, { failure: { precision: "DAY", value: "2026-10-01" } }, { failure: { precision: "INSTANT", value: "2026-10-12T10:00:00Z" } }, { financialApproval: true }, { accessApproval: true }]) {
    assert.equal(debitResultEvidenceSchema.safeParse({ ...unpaid, ...patch }).success, false);
    assert.equal(run([{ ...unpaid, ...patch }]).reconciled, false);
  }
  assert.equal(run([unpaid], [instruction], "2026-10-10").reconciled, false);
  assert.throws(() => run([unpaid], [instruction], "not-a-date"));
  assert.throws(() => run([unpaid], [instruction], "9999-12-31"));
  assert.throws(() => run([unpaid], [instruction], "0000-01-01"));
  assert.throws(() => run(Array(10001).fill(unpaid)), /DEBIT_EVIDENCE_LIMIT/);
});

test("new reducer cannot unblock live debit review without a qualified ingestion adapter", () => {
  assert.equal(run().reconciled, true);
  assert.equal(arrearsAccessReview({ asOf: "2026-10-18", paymentMethod: "DEBIT_ORDER", active: true, issue: null, hold: null, charges: [{ id: "charge", dueDate: "2026-10-01", remaining: 60000 }] }).eligible, false);
});
