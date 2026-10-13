import { isTestPayment } from "./payment-evidence";
export type Payment = { id: string; status: string; amount: unknown; currency: string; environment: string | null; idempotencyKey: string; provider?: string | null; method?: string; processedAt?: Date | null };
export type Receipt = { id: string; type: string; amount: unknown; metadata: unknown; reversalOfId: string | null };
export function verifiedInitialReceipt(payment: Payment, receipts: Receipt[]) {
  if (payment.status !== "SUCCEEDED" || isTestPayment(payment) || payment.currency !== "ZAR" || !payment.processedAt || payment.provider !== "NETCASH" || payment.method !== "PAY_NOW") return false;
  if (receipts.some(receipt => receipt.type === "REFUND" || receipt.type === "REVERSAL")) return false;
  return receipts.some(receipt => {
    const metadata = receipt.metadata as { paymentId?: unknown; verifiedStatus?: unknown; environment?: unknown } | null;
    return receipt.type === "PAYMENT" && Number(receipt.amount) === Number(payment.amount) && metadata?.paymentId === payment.id && metadata.verifiedStatus === true && metadata.environment === "live" && !receipts.some(reversal => reversal.reversalOfId === receipt.id);
  });
}
