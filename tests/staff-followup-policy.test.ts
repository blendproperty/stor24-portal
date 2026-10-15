import assert from "node:assert/strict";
import test from "node:test";
import { staffFollowupSchema, staffFollowupChangeSchema, followupSastInput } from "../src/lib/staff-followup-policy";
import { collectionCallCount } from "../src/lib/operations-reminder-policy";

test("agreed call on 14th uses SAST while a promise due 15th still holds debt chasing", () => {
  assert.equal(followupSastInput("2026-10-14T09:00"), "2026-10-14T07:00:00.000Z");
  assert.equal(collectionCallCount([{ ageing: { issue: null, overdue: 100 }, hold: "PROMISE_TO_PAY", nextFollowUp: "2026-10-14" }], "2026-10-14"), 0);
  const value = { requestKey: "e490a937-3e70-4f09-9749-e640ff07239a", facilityId: "cm00000000000000000000001", customerId: "cm00000000000000000000002", assigneeId: "cm00000000000000000000003", title: "Agreed advance call", description: "Customer agreed to a call on the 14th; payment due 15th.", dueAt: followupSastInput("2026-10-14T09:00") };
  assert.equal(staffFollowupSchema.parse(value).coverId, null);
  assert.equal(staffFollowupSchema.safeParse({ ...value, overridePromiseHold: true }).success, false);
  assert.equal(staffFollowupSchema.safeParse({ ...value, dueAt: "2026-10-14T09:00" }).success, false);
  assert.equal(staffFollowupChangeSchema.safeParse({ action: "ACKNOWLEDGE", expectedUpdatedAt: "2026-10-14T07:00:00.000Z", coverId: value.assigneeId }).success, false);
});
