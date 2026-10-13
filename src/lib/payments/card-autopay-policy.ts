import { createHash } from "node:crypto";
import { z } from "zod";
import { southAfricaDateKey } from "../south-africa-time";

export const CARD_AUTOPAY_TERMS_VERSION = "existing-tenant-fixed-monthly-request-v1";
export const cardAutopayScheduleSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cycles: z.number().int().min(1).max(999),
}).strict();
export type CardAutopaySchedule = z.infer<typeof cardAutopayScheduleSchema>;
export function cardAutopayPeriods(value: unknown, now = new Date()) {
  const schedule = cardAutopayScheduleSchema.parse(value);
  const parsed = new Date(schedule.startDate + "T00:00:00+02:00");
  if (!Number.isFinite(parsed.getTime()) || southAfricaDateKey(parsed) !== schedule.startDate) throw new Error("CARD_AUTOPAY_DATE_INVALID");
  // Restrict the preparation lane to future, whole rental months; never guess catch-up or month-end rules.
  if (!schedule.startDate.endsWith("-01") || schedule.startDate.slice(0, 7) <= southAfricaDateKey(now).slice(0, 7)) throw new Error("CARD_AUTOPAY_FUTURE_MONTH_REQUIRED");
  const [year, month] = schedule.startDate.split("-").map(Number);
  return Array.from({ length: schedule.cycles }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 + i, 1));
    return date.toISOString().slice(0, 7);
  });
}
export function fixedCardAutopayAmount(amounts: number[]) {
  if (amounts.some(amount => Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001)) throw new Error("CARD_AUTOPAY_AMOUNT_INVALID");
  const cents = amounts.map(amount => Math.round(amount * 100));
  if (!cents.length || cents.some(n => !Number.isSafeInteger(n) || n <= 0 || n > 99999999)) throw new Error("CARD_AUTOPAY_AMOUNT_INVALID");
  if (cents.some(n => n !== cents[0])) throw new Error("CARD_AUTOPAY_FIXED_AMOUNT_CHANGES");
  return (cents[0] / 100).toFixed(2);
}
export function cardAutopayFingerprint(source: unknown) {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}
export function cardAutopayRequestText(amount: string, schedule: CardAutopaySchedule) {
  return `I request monthly card payments of R${amount}, starting ${schedule.startDate}, for ${schedule.cycles} payments. This request does not schedule or collect any money. I must separately complete provider-hosted card setup before recurring payments can begin.`;
}
// Pure provider-field preparation only: never sends a form or stores card credentials.
// The initial payment MUST represent an independently approved unpaid invoice; no R1/zero invented enrolment charge.
export function cardAutopayProviderFields(input: { reference: string; approvedInitialInvoiceAmount: number; recurringAmount: number; schedule: CardAutopaySchedule }, now = new Date()) {
  cardAutopayPeriods(input.schedule, now);
  if (!/^[A-Za-z0-9_-]{1,25}$/.test(input.reference)) throw new Error("CARD_AUTOPAY_REFERENCE_INVALID");
  const initialAmount = fixedCardAutopayAmount([input.approvedInitialInvoiceAmount]);
  const recurringAmount = fixedCardAutopayAmount([input.recurringAmount]);
  return { p2: input.reference, p4: initialAmount, m14: "1", m16: "1", m17: String(input.schedule.cycles), m18: "1", m19: input.schedule.startDate, m20: recurringAmount };
}

