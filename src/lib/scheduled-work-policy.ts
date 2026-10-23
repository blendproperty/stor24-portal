import { z } from "zod";

export const scheduledWorkPurposes = ["MEETING", "WORK_BLOCK", "CHECKLIST", "ACCESS_RESTRICTION", "PHYSICAL_OVERLOCK"] as const;
export const scheduledWorkSchema = z.object({
  facilityId: z.string().cuid(),
  unitId: z.string().cuid().nullable().default(null),
  assigneeId: z.string().cuid(),
  purpose: z.enum(scheduledWorkPurposes),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).default(""),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  repeat: z.enum(["ONCE", "DAILY", "MONTHLY"]).default("ONCE"),
  occurrences: z.number().int().min(1).max(366).default(1),
}).strict().superRefine((input, ctx) => {
  if (new Date(input.endAt) <= new Date(input.startAt)) ctx.addIssue({ code: "custom", path: ["endAt"], message: "End time must follow start time." });
  if (new Date(input.endAt).getTime() - new Date(input.startAt).getTime() > 7 * 86400000) ctx.addIssue({ code: "custom", path: ["endAt"], message: "Schedule blocks of no more than seven days." });
  if (input.repeat === "ONCE" && input.occurrences !== 1 || input.repeat === "MONTHLY" && input.occurrences > 24) ctx.addIssue({ code: "custom", path: ["occurrences"], message: "Choose one occurrence, up to 366 daily occurrences, or up to 24 monthly occurrences." });
  if (["ACCESS_RESTRICTION", "PHYSICAL_OVERLOCK"].includes(input.purpose) && !input.unitId) ctx.addIssue({ code: "custom", path: ["unitId"], message: "Choose the relevant unit." });
});
export type ScheduledWorkInput = z.infer<typeof scheduledWorkSchema>;

export function scheduledOccurrences(input: ScheduledWorkInput) {
  const start = new Date(input.startAt), duration = new Date(input.endAt).getTime() - start.getTime();
  return Array.from({ length: input.occurrences }, (_, index) => {
    const at = new Date(start);
    if (input.repeat === "DAILY") at.setUTCDate(start.getUTCDate() + index);
    if (input.repeat === "MONTHLY") {
      // Clamp to month end using the original SAST day, preventing February drift.
      const local = new Date(start.getTime() + 2 * 3600000);
      const year = local.getUTCFullYear(), month = local.getUTCMonth() + index;
      const day = Math.min(local.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
      at.setTime(Date.UTC(year, month, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) - 2 * 3600000);
    }
    return { startAt: at, endAt: new Date(at.getTime() + duration) };
  });
}
