import assert from "node:assert/strict";
import test from "node:test";
import { collectionCallCount, reorderItemCount } from "../src/lib/operations-reminder-policy";

test("reorder counts available stock after holds, including the exact threshold", () => {
  assert.equal(reorderItemCount([
    { quantityOnHand: 10, quantityReserved: 8, reorderPoint: 2 },
    { quantityOnHand: 10, quantityReserved: 0, reorderPoint: 2 },
    { quantityOnHand: 0, quantityReserved: 0, reorderPoint: 0 },
  ]), 2);
});

test("collection calls exclude current debt, future or unscheduled follow-ups, holds and unreliable ageing", () => {
  const due = { ageing: { issue: null, overdue: 100 }, hold: null, nextFollowUp: "2026-10-07" };
  assert.equal(collectionCallCount([
    due, { ...due, nextFollowUp: "2026-10-06" },
    { ...due, nextFollowUp: "2026-10-08" }, { ...due, nextFollowUp: null },
    { ...due, hold: "Disputed" }, { ...due, ageing: { issue: "Unverified receipt", overdue: 100 } },
    { ...due, ageing: { issue: null, overdue: 0 } },
  ], "2026-10-07"), 2);
});
