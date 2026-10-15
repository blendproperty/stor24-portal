import { z } from "zod";
import { dateKey } from "./collections-policy";
import { southAfricaDateKey } from "./south-africa-time";

const id = z.string().min(1).max(100);
const reference = z.string().trim().min(5).max(200);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const reportedReceiptSchema = z.object({
  sourceType: z.literal("MANUAL_REPORTED"),
  evidenceReference: reference,
  receiptDate: dateKey,
  amount: z.string().trim().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine(value => Number(value) > 0),
  currency: z.literal("ZAR"),
  note: z.string().trim().min(5).max(1000),
}).strict();
const importedReceiptSchema = z.object({
  sourceType: z.enum(["BANK_IMPORT_ENTRY", "NETCASH_STATEMENT_LINE"]),
  sourceId: id,
  sourceFingerprint: fingerprint,
}).strict();
export const receiptIntakeSchema = z.object({
  facilityId: id,
  requestKey: z.uuid(),
  source: z.union([reportedReceiptSchema, importedReceiptSchema]),
}).strict();
export const receiptReviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("capture"), ...receiptIntakeSchema.shape }).strict(),
  z.object({ action: z.literal("propose"), id, facilityId: id, revision: z.number().int().min(0), accountId: id, reason: z.string().trim().min(10).max(1000), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("review"), id, facilityId: id, revision: z.number().int().min(0), proposalId: id, decision: z.enum(["REVIEWED", "REJECTED"]), reference, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("withdraw"), id, facilityId: id, revision: z.number().int().min(0), reference, confirmed: z.literal(true) }).strict(),
]);
export type ReceiptIntakeInput = z.infer<typeof receiptIntakeSchema>;
export type ReceiptReviewAction = z.infer<typeof receiptReviewActionSchema>;

export function receiptAmount(value: string): string {
  if (!/^\d{1,8}(?:\.\d{1,4})?$/.test(value) || !(Number(value) > 0)) throw new Error("RECEIPT_REVIEW_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.slice(2).split("").some(char => char !== "0")) throw new Error("RECEIPT_REVIEW_AMOUNT");
  return `${BigInt(whole)}.${fraction.slice(0, 2).padEnd(2, "0")}`;
}
export function assertReceiptDate(value: string, now = new Date()) {
  if (!dateKey.safeParse(value).success || value > southAfricaDateKey(now)) throw new Error("RECEIPT_REVIEW_DATE");
}
export function assertIndependentReceiptReview(capturedBy: string, proposedBy: string, reviewer: string) {
  if (reviewer === capturedBy || reviewer === proposedBy) throw new Error("RECEIPT_REVIEW_INDEPENDENT");
}
export const receiptReviewBoundary = "Matching review only. No receipt, allocation, refund or provider transaction is posted. Reported evidence remains unverified until the separate finance process confirms it.";
