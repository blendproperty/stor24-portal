import test from "node:test";
import assert from "node:assert/strict";
import { scheduledOccurrences, scheduledWorkSchema } from "../src/lib/scheduled-work-policy";
const base = { facilityId: "cm00000000000000000000001", assigneeId: "cm00000000000000000000002", purpose: "CHECKLIST", title: "Daily walkthrough", startAt: "2026-01-30T22:30:00.000Z", endAt: "2026-01-30T23:30:00.000Z" };

test("monthly schedules keep the SAST day and time, clamping each occurrence from the original day", () => {
  const input = scheduledWorkSchema.parse({ ...base, repeat: "MONTHLY", occurrences: 3 });
  const dates = scheduledOccurrences(input);
  assert.deepEqual(dates.map(d => d.startAt.toISOString()), ["2026-01-30T22:30:00.000Z", "2026-02-27T22:30:00.000Z", "2026-03-30T22:30:00.000Z"]);
  assert.ok(dates.every(d => d.endAt.getTime() - d.startAt.getTime() === 3600000));
});
test("daily schedules cross year boundaries and reject invalid recurrence or lockout inputs", () => {
  const input = scheduledWorkSchema.parse({ ...base, startAt: "2026-12-31T08:00:00.000Z", endAt: "2026-12-31T10:00:00.000Z", repeat: "DAILY", occurrences: 2 });
  assert.equal(scheduledOccurrences(input)[1].startAt.toISOString(), "2027-01-01T08:00:00.000Z");
  for (const patch of [{ endAt: base.startAt }, { occurrences: 2 }, { repeat: "DAILY", occurrences: 367 }, { repeat: "MONTHLY", occurrences: 25 }, { purpose: "PHYSICAL_OVERLOCK" }, { purpose: "ACCESS_RESTRICTION" }, { purpose: "PAYROLL" }]) assert.equal(scheduledWorkSchema.safeParse({ ...base, ...patch }).success, false);
});
