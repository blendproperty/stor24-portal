import { isTestPayment } from "@/lib/payments/payment-evidence";

type Payment = { id: string; status: string; amount: string; currency: string; provider: string | null; environment: string | null; idempotencyKey: string; processedAt: Date | null };
type Entry = { id: string; type: string; amount: string; externalRef: string | null; metadata: unknown; reversalOfId: string | null; createdById: string | null };
export type PaymentReviewReason = "AWAITING_CONFIRMATION" | "SOURCE_REVIEW" | "MISSING_RECEIPT" | "DUPLICATE_RECEIPT";

function cents(value: string) {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

/** Attention only. Never treats an authorisation, test success or internal match as bank settlement. */
export function staffPaymentReviewReason(payment: Payment, entries: Entry[]): PaymentReviewReason | null {
  if (isTestPayment(payment)) return null;
  if (payment.status === "PENDING") return "AWAITING_CONFIRMATION";
  if (payment.status !== "SUCCEEDED") return null;
  const amount = cents(payment.amount);
  if (amount === null || amount <= BigInt(0) || payment.currency !== "ZAR" || !payment.processedAt || (payment.provider && payment.environment !== "live")) return "SOURCE_REVIEW";
  const matches = entries.filter(e => e.type === "PAYMENT" && ((e.metadata as { paymentId?: unknown } | null)?.paymentId === payment.id || (!payment.provider && e.externalRef === payment.idempotencyKey)));
  if (!matches.length) return "MISSING_RECEIPT";
  if (matches.length > 1) return "DUPLICATE_RECEIPT";
  const receipt = matches[0], metadata = receipt.metadata as { verifiedStatus?: unknown; environment?: unknown } | null;
  if (cents(receipt.amount) !== amount || entries.some(e => e.reversalOfId === receipt.id) || (payment.provider ? payment.provider !== "NETCASH" || metadata?.verifiedStatus !== true || metadata.environment !== "live" : !receipt.createdById)) return "SOURCE_REVIEW";
  return null;
}
