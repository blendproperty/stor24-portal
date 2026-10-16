import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { collectionScheduleCommand, collectionScheduleWindow, scheduleInput } from "../src/lib/collection-schedule-policy";
const input = { facilityId: "cm00000000000000000000001", label: "Independent daily review", accountIds: ["account-1"], from: "2026-10-15", to: "2026-10-20", weekdays: [4], dueTime: "09:00", reviewMinutes: 60 };
test("schedule requires explicit bounded calendar, selected accounts and same-day review window", () => {
  assert.ok(scheduleInput.safeParse(input).success);
  for (const changed of [{ facilityId: "" }, { accountIds: [] }, { accountIds: ["a", "a"] }, { weekdays: [] }, { weekdays: [4, 4] }, { dueTime: "" }, { dueTime: "24:00" }, { dueTime: "23:55", reviewMinutes: 15 }, { reviewMinutes: 0 }, { to: "2027-01-31" }, { from: "2026-02-30" }, { enabled: true }]) assert.equal(scheduleInput.safeParse({ ...input, ...changed }).success, false, JSON.stringify(changed));
});
test("due evaluation uses South African days and never carries a review into the next day", () => {
  const parsed = scheduleInput.parse(input);
  assert.equal(collectionScheduleWindow(parsed, new Date("2026-10-15T06:59:59Z")).eligible, false);
  assert.equal(collectionScheduleWindow(parsed, new Date("2026-10-15T07:00:00Z")).eligible, true);
  assert.equal(collectionScheduleWindow(parsed, new Date("2026-10-15T08:00:00Z")).eligible, false);
  assert.equal(collectionScheduleWindow(parsed, new Date("2026-10-15T22:01:00Z")).day, "2026-10-16");
  assert.equal(collectionScheduleWindow(parsed, new Date("2026-10-16T07:00:00Z")).eligible, false);
});
test("client commands cannot enable dispatch, fabricate a reviewer or send directly", () => {
  assert.ok(collectionScheduleCommand.safeParse({ action: "create", requestKey: randomUUID(), input, confirm: true }).success);
  for (const action of ["send", "activate", "retry", "auto-approve"]) assert.equal(collectionScheduleCommand.safeParse({ action, input }).success, false);
  assert.equal(collectionScheduleCommand.safeParse({ action: "create", requestKey: randomUUID(), input, confirm: true, reviewerId: input.facilityId }).success, false);
});
