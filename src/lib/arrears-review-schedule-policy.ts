import { z } from "zod";
import { southAfricaDateKey } from "./south-africa-time";
import { statementPeriod } from "./finance/account-statement";

export const ARREARS_REVIEW_SCHEDULE = "ARREARS_ACCESS_REVIEW_SCHEDULE";
export const arrearsReviewScheduleInput = z.object({
  from: z.iso.date(), until: z.iso.date(), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).strict().superRefine((value, ctx) => {
  const days = (Date.parse(value.until) - Date.parse(value.from)) / 86_400_000;
  if (days < 0 || days > 92) ctx.addIssue({ code: "custom", message: "Choose up to 93 calendar days, including weekends." });
});
export type ArrearsReviewScheduleInput = z.infer<typeof arrearsReviewScheduleInput>;
export function nextArrearsReviewAt(input: ArrearsReviewScheduleInput, afterDay?: string) {
  const next = afterDay ? southAfricaDateKey(new Date(statementPeriod(afterDay, afterDay).start.getTime() + 86_400_000)) : input.from;
  return new Date(`${next}T${input.time}:00+02:00`).toISOString();
}
export function arrearsReviewScheduleWindow(input: ArrearsReviewScheduleInput, nextDueAt: string, now: Date) {
  const day = southAfricaDateKey(now);
  return { day, expired: day > input.until, due: day >= input.from && day <= input.until && now >= new Date(nextDueAt) && now >= new Date(`${day}T${input.time}:00+02:00`) };
}
