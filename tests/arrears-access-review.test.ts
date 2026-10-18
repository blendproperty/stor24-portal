import assert from "node:assert/strict";
import test from "node:test";
import { arrearsAccessReview } from "../src/lib/arrears-access-review-policy";
const source = { asOf: "2026-10-18", paymentMethod: "EFT", active: true, issue: null, hold: null, charges: [{ id: "charge1", dueDate: "2026-10-11", remaining: 100 }] };
test("seven calendar days include weekends and use SAST dates", () => {
  assert.equal(arrearsAccessReview(source).reviewOn, "2026-10-18");
  assert.equal(arrearsAccessReview(source).eligible, true);
  assert.equal(arrearsAccessReview({ ...source, asOf: "2026-10-17" }).eligible, false);
  assert.equal(arrearsAccessReview({ ...source, paymentMethod: "CARD" }).eligible, true);
  assert.equal(arrearsAccessReview({ ...source, asOf: "2027-01-07", charges: [{ id: "year", dueDate: "2026-12-31", remaining: 1 }] }).reviewOn, "2027-01-07");
});
test("pending, dispute, reconciliation, inactive, unknown method and paid debt hold preparation", () => {
  for (const change of [{ hold: "Payment awaiting confirmation" }, { hold: "Dispute hold" }, { hold: "Agreed promise" }, { issue: "Unverified receipts" }, { active: false }, { paymentMethod: null }, { charges: [] }, { charges: [{ ...source.charges[0], remaining: 0 }] }]) assert.equal(arrearsAccessReview({ ...source, ...change }).eligible, false);
});
test("debit order never substitutes due date for confirmed failure", () => {
  const result = arrearsAccessReview({ ...source, paymentMethod: "DEBIT_ORDER" });
  assert.equal(result.eligible, false); assert.equal(result.reviewOn, null);
  assert.match(result.blockers.join(" "), /authoritative confirmed debit failure/);
});
test("partial payment preserves original oldest unpaid date; full coverage moves to remaining debt", () => {
  const result = arrearsAccessReview({ ...source, charges: [{ ...source.charges[0], remaining: 1 }, { id: "new", dueDate: "2026-10-17", remaining: 200 }] });
  assert.equal(result.reviewOn, "2026-10-18"); assert.equal(result.sourceChargeId, "charge1");
  const covered = arrearsAccessReview({ ...source, charges: [{ ...source.charges[0], remaining: 0 }, { id: "new", dueDate: "2026-10-17", remaining: 200 }] });
  assert.equal(covered.reviewOn, "2026-10-24"); assert.equal(covered.eligible, false);
  assert.equal(result.financialApproval, false); assert.equal(result.accessApproval, false);
});
