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
const text = z.string().trim().max(2000);
export const checklistRowSchema = z.object({
  id: z.string().min(1).max(100), label: z.string().min(1).max(300),
  expected: z.enum(["PASS", "VACANT", "OCCUPIED", "REVIEW"]),
  state: z.enum(["PENDING", "PASS", "ISSUE", "NA", "VACANT", "OCCUPIED", "OVERLOCKED"]),
  notes: text, evidence: z.string().trim().max(500), lockCount: z.number().int().min(0).max(100).nullable(), overlockTask: z.boolean(),
}).strict();
export type ChecklistRow = z.infer<typeof checklistRowSchema>;
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
export const checklistChangeSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.enum(["START", "RESTART", "CANCEL"]) }).strict(),
  z.object({ ...identity, action: z.enum(["SAVE", "SUBMIT"]), rows: z.array(z.object({ id: z.string(), state: checklistRowSchema.shape.state, notes: text, evidence: z.string().trim().max(500), lockCount: checklistRowSchema.shape.lockCount }).strict()).max(1500), summary: text, comparisonReference: z.string().trim().max(1000) }).strict(),
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
  return row.expected === "PASS" ? ["ISSUE", "NA"].includes(row.state) : row.expected === "REVIEW" || row.state === "OVERLOCKED" || row.state !== row.expected || row.overlockTask;
}
export function validateChecklistSubmission(record: ChecklistRecord) {
  if (!record.rows.length) throw new Error("CHECKLIST_INCOMPLETE");
  for (const row of record.rows) {
    const allowed = record.template === "PADLOCK" ? ["VACANT", "OCCUPIED", "OVERLOCKED"] : ["PASS", "ISSUE", "NA"];
    if (!allowed.includes(row.state) || (record.template === "PADLOCK" || row.label.includes("trolleys")) && row.lockCount === null || (checklistIssue(row) || row.state === "NA") && row.notes.length < 5) throw new Error("CHECKLIST_INCOMPLETE");
  }
  if (record.template === "PADLOCK" && record.comparisonReference.length < 5) throw new Error("CHECKLIST_COMPARISON_REQUIRED");
}
