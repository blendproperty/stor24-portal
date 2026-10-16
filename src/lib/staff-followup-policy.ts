import { z } from "zod";

/** An agreed appointment is separate from debt-chasing eligibility. Never overrides a promise hold. */
export const staffFollowupSchema = z.object({
  requestKey: z.string().uuid(),
  facilityId: z.string().cuid(),
  customerId: z.string().cuid(),
  assigneeId: z.string().cuid(),
  coverId: z.string().cuid().nullable().default(null),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().min(2).max(4000),
  dueAt: z.iso.datetime({ offset: true }),
}).strict();

export const staffFollowupChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACKNOWLEDGE"), expectedUpdatedAt: z.iso.datetime() }).strict(),
  z.object({ action: z.literal("HANDOVER"), coverId: z.string().cuid().nullable(), expectedUpdatedAt: z.iso.datetime() }).strict(),
  staffFollowupSchema.omit({ requestKey: true, facilityId: true, customerId: true }).extend({ action: z.literal("UPDATE"), expectedUpdatedAt: z.iso.datetime() }).strict(),
  z.object({ action: z.literal("COMPLETE"), expectedUpdatedAt: z.iso.datetime() }).strict(),
  z.object({ action: z.literal("CANCEL"), expectedUpdatedAt: z.iso.datetime() }).strict(),
]);

export const staffFollowupViewSchema = z.enum(["all", "due", "upcoming"]);
export type StaffFollowupView = z.infer<typeof staffFollowupViewSchema>;

export function followupDayEnd(now: Date) {
  const tomorrow = new Date(now.getTime() + 86_400_000 + 7_200_000).toISOString().slice(0, 10);
  return new Date(`${tomorrow}T00:00:00+02:00`);
}

export function followupSastValue(value: string) {
  return new Date(new Date(value).getTime() + 7_200_000).toISOString().slice(0, 16);
}

export function followupSastInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid date and time.");
  const parsed = new Date(`${value}:00+02:00`);
  if (!Number.isFinite(parsed.getTime()) || followupSastValue(parsed.toISOString()) !== value) throw new Error("Choose a valid date and time.");
  return parsed.toISOString();
}
