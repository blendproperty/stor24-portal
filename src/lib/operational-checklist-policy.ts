import { z } from "zod";
import { scheduledOccurrences, scheduledWorkSchema } from "./scheduled-work-policy";
import { southAfricaDateKey } from "./south-africa-time";

export const CHECKLIST_PURPOSE = "OPERATIONAL_CHECKLIST";
export const checklistTemplates = {
  OPENING: { name: "Opening checklist", groups: {
    "Opening": ["Disarm alarm", "Check fire panel for errors", "Check power is on", "Check office phone is charging", "Check cameras", "Check generator for damage", "Check HVAC on all floors"],
    "Ground floor": ["Check admin door operation", "Check front and back gardens", "Check cameras", "Check sprinklers", "Check lights", "Check units are secure", "Check fire extinguishers", "Count and check trolleys"],
    "First floor": ["Check fire extinguishers", "Check elevator doors", "Check fire escape is clear", "Check units are secure", "Check lights", "Check sprinklers", "Count and check trolleys"],
    "Second floor": ["Check fire extinguishers", "Check units are secure", "Check fire escape is clear", "Check elevator doors", "Check lights", "Check sprinklers", "Count and check trolleys"],
    "Back yard": ["Check bin room is locked", "Check yard is in order", "Check water tanks for leaks", "Check pump room is locked", "Check back doors for forced entry"],
  } },
  CLOSING: { name: "Closing checklist", groups: { "Evening": ["Check all doors are locked", "Check back gates are closed", "Lock office door", "Check office phone is charging", "Switch office lights off", "Check kitchen tap is closed", "Arm alarm", "Check dedicated plugs remain on", "Close entry and exit gates", "Switch air conditioners off", "Count ground floor trolleys", "Count first floor trolleys", "Count second floor trolleys"] } },
  CLEANING: { name: "Cleaning roster", groups: {
    "Reception": ["Dust", "Sweep", "Polish counter", "Empty bin", "Mop admin area"],
    "Front and back yard": ["Sweep main parking", "Wipe building signage", "Sweep back yard", "Dust generator"],
    "Kitchen": ["Sweep and mop", "Polish counter"],
    "Storage floors": ["Sweep", "Mop", "Dust hose reels and extinguishers", "Clean unit doors", "Sweep empty units", "Check and empty bait boxes"],
  } },
  MANAGEMENT: { name: "Management checklist", groups: { "Daily": ["Check alarm arming and disarming", "Check CCTV display", "Check air conditioning", "Check fire panel for errors", "Check alarm panel for errors", "Check camera display for errors", "Check entrance for breach", "Check pump room and ICV room", "Check tanks for leaks", "Check generator for tampering", "Check HVAC", "Check kitchen plumbing for leaks", "Check DB boards for trips", "Check UPS for errors", "Check ramp balustrade for wear", "Check CCTV operation", "Check entrance doors lock", "Review opening and closing checklists", "Check fire equipment service dates"] } },
  PADLOCK: { name: "Weekly padlock walkthrough", groups: {} },
} as const;
export const templateKeySchema = z.enum(["OPENING", "CLOSING", "CLEANING", "MANAGEMENT", "PADLOCK"]);
export type ChecklistTemplate = z.infer<typeof templateKeySchema>;

export type ChecklistRouteTemplate = Exclude<ChecklistTemplate, "PADLOCK">;

export function checklistUsesRoute(template?: ChecklistTemplate): template is ChecklistRouteTemplate {
  return template !== undefined && template !== "PADLOCK";
}

export function checklistWeek(at: Date | string) {
  const day = new Date(`${southAfricaDateKey(at)}T00:00:00+02:00`);
  const weekday = new Date(`${southAfricaDateKey(at)}T12:00:00Z`).getUTCDay();
  const monday = day.getTime() - (weekday + 6) % 7 * 86400000;
  return Array.from({ length: 8 }, (_, index) => new Date(monday + index * 86400000));
}

export function checklistHref(title: string, id: string) {
  const page = title === checklistTemplates.PADLOCK.name ? "padlocks" : "checklists";
  return `/operations/${page}?id=${encodeURIComponent(id)}`;
}

const text = z.string().trim().max(2000);
export const checklistRowSchema = z.object({
  id: z.string().min(1).max(100), label: z.string().min(1).max(300),
  expected: z.enum(["PASS", "VACANT", "OCCUPIED", "REVIEW"]),
  state: z.enum(["PENDING", "PASS", "ISSUE", "NA", "VACANT", "OCCUPIED", "OVERLOCKED"]),
  notes: text, evidence: z.string().trim().max(500), lockCount: z.number().int().min(0).max(100).nullable(), overlockTask: z.boolean(), comparisonDiscrepancy: z.boolean().optional(),
}).strict();
export type ChecklistRow = z.infer<typeof checklistRowSchema>;
const padlockMapUnitSchema = z.object({ id: z.string(), label: z.string() });
export const padlockMapSchema = z.object({
  units: z.array(padlockMapUnitSchema),
  floors: z.array(z.object({
    id: z.string(), name: z.string(), operational: z.boolean(), width: z.number(), height: z.number(),
    elements: z.array(z.object({
      id: z.string(), type: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      rotation: z.number(), label: z.string().nullable(), unitId: z.string().nullable(),
    })),
  })),
});
export type PadlockMapData = z.infer<typeof padlockMapSchema>;
export const checklistRecordSchema = z.object({
  version: z.literal(1), template: templateKeySchema, reviewerId: z.string().cuid(),
  rows: z.array(checklistRowSchema).max(1500), sourceAt: z.iso.datetime().nullable(), sourceHash: z.string().nullable(),
  comparisonReference: z.string().trim().max(1000), summary: text,
  submittedBy: z.string().nullable(), submittedAt: z.iso.datetime().nullable(), reviewNote: text,
  reviewedBy: z.string().nullable(), reviewedAt: z.iso.datetime().nullable(),
}).strict();
export type ChecklistRecord = z.infer<typeof checklistRecordSchema>;
export const checklistCreateSchema = z.object({
  facilityId: z.string().cuid(), template: templateKeySchema, assigneeId: z.string().cuid(), coverId: z.string().cuid().nullable(), reviewerId: z.string().cuid(),
  startAt: z.iso.datetime(), endAt: z.iso.datetime(), repeat: z.enum(["ONCE", "DAILY", "WEEKLY"]), occurrences: z.number().int().min(1).max(31), requestKey: z.uuid(),
}).strict().superRefine((v, ctx) => {
  if (v.reviewerId === v.assigneeId || v.reviewerId === v.coverId) ctx.addIssue({ code: "custom", path: ["reviewerId"], message: "Choose a reviewer separate from the preparer and absence cover." });
  if (v.coverId === v.assigneeId) ctx.addIssue({ code: "custom", path: ["coverId"], message: "Choose a different absence cover." });
  if (v.repeat === "ONCE" && v.occurrences !== 1) ctx.addIssue({ code: "custom", path: ["occurrences"], message: "A one-off run has one occurrence." });
  if (v.template === "PADLOCK" && v.repeat === "DAILY") ctx.addIssue({ code: "custom", path: ["repeat"], message: "Plan padlock checks once or weekly." });
  if (new Date(v.endAt) <= new Date(v.startAt) || new Date(v.endAt).getTime() - new Date(v.startAt).getTime() > 86400000) ctx.addIssue({ code: "custom", path: ["endAt"], message: "Choose a check window ending after its start, within 24 hours." });
});
export type ChecklistCreate = z.infer<typeof checklistCreateSchema>;
const identity = { id: z.string().cuid(), expectedUpdatedAt: z.iso.datetime() };
const editableRow = checklistRowSchema.pick({ id: true, state: true, notes: true, evidence: true, lockCount: true, comparisonDiscrepancy: true });
const reportFields = { summary: text, comparisonReference: z.string().trim().max(1000) };
export const checklistChangeSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.enum(["START", "RESTART", "CANCEL"]) }).strict(),
  z.object({ ...identity, ...reportFields, action: z.enum(["SAVE", "SUBMIT"]), rows: z.array(editableRow).max(1500) }).strict(),
  z.object({ ...identity, ...reportFields, action: z.literal("OBSERVE"), row: editableRow.extend({
    state: z.enum(["PASS", "ISSUE", "NA", "VACANT", "OCCUPIED", "OVERLOCKED"]),
  }) }).strict(),
  z.object({ ...identity, action: z.enum(["APPROVE", "RETURN"]), note: z.string().trim().min(5).max(2000) }).strict(),
  z.object({ ...identity, action: z.literal("ASSIGN"), assigneeId: z.string().cuid(), coverId: z.string().cuid().nullable(), reviewerId: z.string().cuid() }).strict(),
]);
export type ChecklistChange = z.infer<typeof checklistChangeSchema>;

export function checklistDates(input: ChecklistCreate) {
  const schedule = scheduledWorkSchema.parse({ ...Object.fromEntries(["facilityId", "assigneeId", "startAt", "endAt", "occurrences"].map(k => [k, input[k as keyof ChecklistCreate]])), title: "Checklist", purpose: "CHECKLIST", repeat: input.repeat === "ONCE" ? "ONCE" : "DAILY" });
  return scheduledOccurrences(schedule).map((dates, index) => input.repeat === "WEEKLY" ? { startAt: new Date(dates.startAt.getTime() + index * 6 * 86400000), endAt: new Date(dates.endAt.getTime() + index * 6 * 86400000) } : dates);
}
export function checklistRows(template: ChecklistTemplate, at: Date): ChecklistRow[] {
  const labels = Object.entries(checklistTemplates[template].groups).flatMap(([group, items]) => items.map((item: string) => `${group} · ${item}`));
  const day = new Date(`${southAfricaDateKey(at)}T12:00:00Z`).getUTCDay();
  if (template === "MANAGEMENT" && day === 5) labels.push("Friday · Test pump room and ICV equipment", "Friday · Test generator");
  if (template === "CLEANING" && day === 0) labels.push("Sunday · Clean reception windows", "Sunday · Clean floor in front of office");
  return labels.map((label, i) => ({ id: String(i), label, expected: "PASS", state: "PENDING", notes: "", evidence: "", lockCount: null, overlockTask: false }));
}
export function checklistIssue(row: ChecklistRow) {
  return row.expected === "PASS" ? ["ISSUE", "NA"].includes(row.state) : row.expected === "REVIEW" || row.state === "OVERLOCKED" || row.state !== row.expected || row.overlockTask || row.comparisonDiscrepancy === true;
}
export function checklistNeedsTrolleyCount(row: ChecklistRow) {
  return row.label.includes("trolleys");
}
export function checklistRouteResultReady(row: ChecklistRow) {
  return ["PASS", "ISSUE", "NA"].includes(row.state) &&
    (!checklistNeedsTrolleyCount(row) || row.lockCount !== null) &&
    (!(checklistIssue(row) || row.state === "NA") || row.notes.trim().length >= 5);
}
export function validateChecklistSubmission(record: ChecklistRecord) {
  if (!record.rows.length) throw new Error("CHECKLIST_INCOMPLETE");
  for (const row of record.rows) {
    const ready = record.template === "PADLOCK"
      ? ["VACANT", "OCCUPIED", "OVERLOCKED"].includes(row.state) && row.lockCount !== null && (!checklistIssue(row) || row.notes.length >= 5)
      : checklistRouteResultReady(row);
    if (!ready) throw new Error("CHECKLIST_INCOMPLETE");
  }
  if (record.template === "PADLOCK" && record.comparisonReference.length < 5) throw new Error("CHECKLIST_COMPARISON_REQUIRED");
}
