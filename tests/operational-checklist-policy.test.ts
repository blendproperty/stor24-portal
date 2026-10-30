import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { checklistCreateSchema, checklistDates, checklistRows, checklistRecordSchema, validateChecklistSubmission } from "../src/lib/operational-checklist-policy";
const base = { facilityId: "cm00000000000000000000001", assigneeId: "cm00000000000000000000002", reviewerId: "cm00000000000000000000003", coverId: null, template: "OPENING", startAt: "2026-12-31T22:30:00Z", endAt: "2026-12-31T23:30:00Z", repeat: "DAILY", occurrences: 3, requestKey: randomUUID() };
test("checklists retain SAST daily/weekly boundaries and reject ambiguous staff or unbounded schedules", () => {
  const input = checklistCreateSchema.parse(base);
  assert.equal(checklistDates(input)[2].startAt.toISOString(), "2027-01-02T22:30:00.000Z");
  assert.equal(checklistDates({ ...input, repeat: "WEEKLY" })[2].startAt.toISOString(), "2027-01-14T22:30:00.000Z");
  for (const patch of [{ occurrences: 32 }, { occurrences: 0 }, { repeat: "ONCE" }, { reviewerId: base.assigneeId }, { coverId: base.reviewerId }, { coverId: base.assigneeId }, { endAt: base.startAt }, { template: "PADLOCK" }]) assert.equal(checklistCreateSchema.safeParse({ ...base, ...patch }).success, false);
  assert.equal(checklistCreateSchema.safeParse({ ...base, template: "PADLOCK", repeat: "WEEKLY" }).success,true);
});
test("Friday tests and Sunday cleaning follow the scheduled SAST day, not UTC day", () => {
  const friday = checklistRows("MANAGEMENT", new Date("2026-10-29T23:00:00Z"));
  assert.equal(friday.filter(r => r.label.startsWith("Friday")).length,2);
  assert.equal(checklistRows("MANAGEMENT",new Date("2026-10-29T20:00:00Z")).some(r => r.label.startsWith("Friday")),false);
  assert.equal(checklistRows("CLEANING",new Date("2026-10-31T23:00:00Z")).filter(r => r.label.startsWith("Sunday")).length,2);
});
test("submission requires all results, trolley counts, reasons and padlock comparison evidence", () => {
  const record = checklistRecordSchema.parse({ version: 1,template:"CLOSING",reviewerId:base.reviewerId,rows:checklistRows("CLOSING",new Date()),sourceAt:new Date().toISOString(),sourceHash:null,comparisonReference:"",summary:"",submittedBy:null,submittedAt:null,reviewNote:"",reviewedBy:null,reviewedAt:null });
  assert.throws(() => validateChecklistSubmission(record),/INCOMPLETE/);
  record.rows = record.rows.map(r => ({ ...r,state:"PASS",lockCount:r.label.includes("trolleys")?2:null })); validateChecklistSubmission(record);
  record.rows[0].state="NA";assert.throws(() => validateChecklistSubmission(record),/INCOMPLETE/);record.rows[0].notes="Not installed at this store";validateChecklistSubmission(record);
  const padlock = { ...record, template: "PADLOCK" as const, rows: [{ ...record.rows[0],expected:"VACANT" as const,state:"OVERLOCKED" as const,lockCount:2,notes:"" }] };
  assert.throws(() => validateChecklistSubmission(padlock),/INCOMPLETE/);padlock.rows[0].notes="Found physical overlock; referred to manager";
  assert.throws(() => validateChecklistSubmission(padlock),/COMPARISON/);padlock.comparisonReference="Rent roll and collections reviewed today";validateChecklistSubmission(padlock);
});
