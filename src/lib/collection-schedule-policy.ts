import { z } from "zod";
import { southAfricaDateKey } from "./south-africa-time";

export const COLLECTION_SCHEDULE_PLAN = "COLLECTION_SCHEDULE_PLAN";
export const COLLECTION_SCHEDULE_RUN = "COLLECTION_SCHEDULE_RUN";
export const scheduleHash = z.string().regex(/^[a-f0-9]{64}$/);
export const schedulePlanId = z.string().regex(/^collection-plan:[a-f0-9-]{36}$/);
export const scheduleRunId = z.string().regex(/^collection-run:[a-f0-9]{64}$/);
export const scheduleInput = z.object({
  facilityId: z.cuid(), label: z.string().trim().min(3).max(120),
  accountIds: z.array(z.string().min(1).max(100)).min(1).max(20).refine(ids => new Set(ids).size === ids.length).transform(ids => ids.toSorted()),
  from: z.iso.date(), to: z.iso.date(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length).transform(days => days.toSorted()),
  dueTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  reviewMinutes: z.number().int().min(15).max(720),
}).strict().superRefine((input, ctx) => {
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
  if (days < 0 || days > 92) ctx.addIssue({ code: "custom", message: "Choose a schedule of up to93 South African calendar days." });
  const minutes = Number(input.dueTime.slice(0, 2)) * 60 + Number(input.dueTime.slice(3));
  if (minutes + input.reviewMinutes > 1440) ctx.addIssue({ code: "custom", message: "The review and delivery window must end by midnight on the same South African day." });
});
export type CollectionScheduleInput = z.infer<typeof scheduleInput>;
export function collectionScheduleWindow(input: CollectionScheduleInput, now: Date) {
  const day = southAfricaDateKey(now), due = new Date(`${day}T${input.dueTime}:00+02:00`);
  const expires = new Date(due.getTime() + input.reviewMinutes * 60000);
  const weekday = new Date(`${day}T12:00:00+02:00`).getUTCDay();
  return { day, due, expires, eligible: day >= input.from && day <= input.to && input.weekdays.includes(weekday) && now >= due && now < expires };
}
export const collectionScheduleCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestKey: z.uuid(), input: scheduleInput, confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("evaluate"), id: schedulePlanId, revision: z.uuid() }).strict(),
  z.object({ action: z.literal("cancel-plan"), id: schedulePlanId, revision: z.uuid(), reference: z.string().trim().min(3).max(240) }).strict(),
  z.object({ action: z.literal("review-run"), id: scheduleRunId, revision: z.uuid(), fingerprint: scheduleHash, decision: z.enum(["APPROVE", "CANCEL"]), reference: z.string().trim().min(3).max(240), confirm: z.literal(true) }).strict(),
]);
