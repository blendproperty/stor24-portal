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
  z.object({ action: z.literal("COMPLETE"), expectedUpdatedAt: z.iso.datetime() }).strict(),
  z.object({ action: z.literal("CANCEL"), expectedUpdatedAt: z.iso.datetime() }).strict(),
]);

export function followupSastInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a date and time.");
  return new Date(`${value}:00+02:00`).toISOString();
}
