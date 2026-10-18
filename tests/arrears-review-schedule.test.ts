import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { arrearsReviewScheduleInput, arrearsReviewScheduleWindow, nextArrearsReviewAt } from "../src/lib/arrears-review-schedule-policy";
import { collectionActionSchema } from "../src/lib/collections-policy";

test("daily review uses explicit SAST time and includes Saturday and Sunday", () => {
  const input = arrearsReviewScheduleInput.parse({ from: "2026-10-17", until: "2026-10-18", time: "09:00" });
  const due = nextArrearsReviewAt(input);
  assert.equal(due, "2026-10-17T07:00:00.000Z");
  assert.equal(arrearsReviewScheduleWindow(input, due, new Date("2026-10-17T06:59:59Z")).due, false);
  assert.equal(arrearsReviewScheduleWindow(input, due, new Date("2026-10-17T07:00:00Z")).due, true);
  const sunday = nextArrearsReviewAt(input, "2026-10-17");
  assert.equal(sunday, "2026-10-18T07:00:00.000Z");
  assert.equal(arrearsReviewScheduleWindow(input, sunday, new Date(sunday)).due, true);
});
test("expired, future and missed earlier-day plans do not backdate a task", () => {
  const input = { from: "2026-10-17", until: "2026-10-18", time: "09:00" };
  assert.equal(arrearsReviewScheduleWindow(input, nextArrearsReviewAt(input), new Date("2026-10-16T21:59:59Z")).due, false);
  const missed = arrearsReviewScheduleWindow(input, nextArrearsReviewAt(input), new Date("2026-10-18T06:00:00Z"));
  assert.equal(missed.due, false); assert.equal(missed.day, "2026-10-18");
  const expired = arrearsReviewScheduleWindow(input, nextArrearsReviewAt(input), new Date("2026-10-18T22:00:00Z"));
  assert.equal(expired.expired, true); assert.equal(expired.due, false);
  assert.equal(nextArrearsReviewAt({ ...input, time: "00:00" }, "2026-12-31"), "2026-12-31T22:00:00.000Z");
});
test("date/time ranges and money/access fields cannot be silently selected", () => {
  const input = { from: "2026-10-17", until: "2026-10-18", time: "09:00" };
  for (const bad of [{ ...input, until: "2026-10-16" }, { ...input, until: "2027-02-01" }, { ...input, time: "24:00" }, { ...input, from: "2026-02-30" }, { ...input, amount: "100" }, { ...input, restrictAccess: true }]) assert.equal(arrearsReviewScheduleInput.safeParse(bad).success, false);
  const base = { accountId: "cmfixtureaccount000000001", revision: 0, requestKey: randomUUID(), note: "Actual delegation evidence", action: "schedule-access-review", scheduleRevision: null, input, confirm: true };
  assert.equal(collectionActionSchema.safeParse(base).success, true);
  for (const bad of [{ ...base, confirm: false }, { ...base, feeAmount: "100" }, { ...base, approve: true }, { ...base, send: true }, { ...base, scheduleRevision: "stale" }]) assert.equal(collectionActionSchema.safeParse(bad).success, false);
});
