import assert from "node:assert/strict";
import test from "node:test";
import { canRetainTaskData } from "../src/lib/staff-retained-task-data";
const user = "c123456789012345678901234";
const other = "c223456789012345678901234";
const base = { version: 1, template: "OPENING", reviewerId: other, rows: [], sourceAt: null, sourceHash: null, comparisonReference: "", summary: "", submittedBy: user, submittedAt: null, reviewNote: "", reviewedBy: null, reviewedAt: null };
test("retained task data accepts known historical attribution and rejects live or unclassified references", () => {
  const task = { purpose: "OPERATIONAL_CHECKLIST", status: "WAITING", operationalForm: null, operationalChecklist: base };
  assert.equal(canRetainTaskData(task, user), true);
  assert.equal(canRetainTaskData({ ...task, operationalChecklist: { ...base, reviewerId: user } }, user), false);
  assert.equal(canRetainTaskData({ ...task, status: "COMPLETED", operationalChecklist: { ...base, reviewerId: user } }, user), true);
  assert.equal(canRetainTaskData({ ...task, operationalChecklist: { ...base, summary: user } }, user), false);
  assert.equal(canRetainTaskData({ ...task, unexpectedReference: true }, user), false);
  assert.equal(canRetainTaskData({ ...task, operationalChecklist: { ...base, submittedBy: `prefix-${user}` } }, user), false);
  assert.equal(canRetainTaskData({ ...task, purpose: "UNKNOWN" }, user), false);
});
