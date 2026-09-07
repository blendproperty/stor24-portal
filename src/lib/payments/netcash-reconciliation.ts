type PaymentLike = {
  id: string;
  status: string;
  amount: unknown;
  providerRef: string | null;
};

type LedgerLike = {
  id: string;
  type: string;
  amount: unknown;
  externalRef: string | null;
  metadata: unknown;
};

export type NetcashReconciliationState = "MATCHED" | "MISSING_LEDGER" | "DUPLICATE_LEDGER" | "PENDING" | "FAILED";

function metadataPaymentId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (typeof record.paymentId === "string") return record.paymentId;
  const posted = record.postedPayload;
  if (posted && typeof posted === "object" && !Array.isArray(posted)) {
    const reference = (posted as Record<string, unknown>).Reference;
    return typeof reference === "string" ? reference : null;
  }
  return null;
}

export function reconcileNetcashPayment(payment: PaymentLike, ledgerEntries: LedgerLike[]) {
  if (payment.status === "PENDING") return { state: "PENDING" as const, ledgerEntryId: null };
  if (payment.status !== "SUCCEEDED") return { state: "FAILED" as const, ledgerEntryId: null };

  const matches = ledgerEntries.filter((entry) =>
    entry.type === "PAYMENT"
    && Number(entry.amount) === Number(payment.amount)
    && (metadataPaymentId(entry.metadata) === payment.id || entry.externalRef === payment.providerRef),
  );
  if (matches.length === 0) return { state: "MISSING_LEDGER" as const, ledgerEntryId: null };
  if (matches.length > 1) return { state: "DUPLICATE_LEDGER" as const, ledgerEntryId: matches[0].id };
  return { state: "MATCHED" as const, ledgerEntryId: matches[0].id };
}
