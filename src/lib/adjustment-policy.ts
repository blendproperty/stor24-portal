import { z } from "zod";

export const adjustmentKinds = ["CHARGE", "CREDIT", "WRITE_OFF", "REVERSAL", "REFUND"] as const;
export const adjustmentLabels: Record<string, string> = { CHARGE: "Additional charge", CREDIT: "Credit against a charge", WRITE_OFF: "Write off unpaid debt", REVERSAL: "Reverse a receipt (NSF / error)", REFUND: "Refund a cleared overpayment" };
export const moneyText = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/);
export const evidenceText = z.string().trim().min(5).max(200);
export const adjustmentInputSchema = z.object({
  accountId: z.string().cuid(), kind: z.enum(adjustmentKinds), amount: moneyText,
  taxAmount: moneyText.default("0"), sourceEntryId: z.string().cuid().nullable().default(null),
  reason: z.string().trim().min(10).max(500), evidenceReference: evidenceText,
}).strict().refine(v => Number(v.amount) > 0 && Number(v.taxAmount) <= Number(v.amount), "Invalid amount or tax");
export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
export function cents(value: string | number) {
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error("ADJUSTMENT_INVALID_AMOUNT");
  return result;
}
export const amountText = (value: number) => (value / 100).toFixed(2);
export function adjustmentDelta(kind: string, amount: number) {
  return ["CREDIT", "WRITE_OFF"].includes(kind) ? -amount : amount;
}
export function refundLimits(config: unknown) {
  const raw = config as { defaults?: { Refunds?: { minimumRefund?: unknown; maximumRefund?: unknown } } } | null;
  const settings = raw?.defaults?.Refunds;
  const parse = (v: unknown) => {
    if (v === undefined) return 0;
    if ((typeof v !== "number" && typeof v !== "string") || !Number.isFinite(Number(v)) || Number(v) < 0) throw new Error("ADJUSTMENT_POLICY_REVIEW");
    return cents(Number(v));
  };
  return { minimum: parse(settings?.minimumRefund), maximum: parse(settings?.maximumRefund) };
}
export const adjustmentMessages: Record<string, string> = {
  ADJUSTMENT_UNPAID_CONFIRMATION: "Confirm that no external payout occurred before cancelling this approved refund.",
  ADJUSTMENT_NOT_FOUND: "This account or request is outside your permitted stores.",
  ADJUSTMENT_OPEN_REQUEST: "An adjustment is already awaiting action on this account. Resolve it first.",
  ADJUSTMENT_CHANGED: "The account or policy changed after review. Cancel and prepare a fresh request.",
  ADJUSTMENT_SELF_APPROVAL: "A different authorised staff member must approve this request.",
  ADJUSTMENT_STATE: "This request is no longer available for that action. Reload its history.",
  ADJUSTMENT_SOURCE: "Select an eligible original charge or verified receipt from this account.",
  ADJUSTMENT_EXCEEDS_SOURCE: "The amount exceeds the unadjusted original entry or available balance.",
  ADJUSTMENT_RECONCILIATION: "Account and ledger balances do not agree. Finance reconciliation is required first.",
  ADJUSTMENT_TEST_REVIEW: "Historical test payments require separate reconciliation before corrections or refunds.",
  ADJUSTMENT_COLLECTION_PENDING: "A collection run still reserves this account. Resolve the run before changing its balance.",
  ADJUSTMENT_POLICY_REVIEW: "This refund is outside the configured limits or the policy is invalid. Finance must review the policy.",
  ADJUSTMENT_PAYOUT_DATE: "Use a valid payout date between approval and today.",
  ADJUSTMENT_TAX: "Tax is calculated from the original charge for credits; write-offs, receipt reversals and refunds carry no tax adjustment.",
  ADJUSTMENT_DUPLICATE: "The reference is already in use or another user changed this account. Reload before retrying.",
};
