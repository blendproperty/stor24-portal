/** Pure order rules. No provider calls, stock mutations or ledger postings. */
export type MerchandiseOrderStatus = "AWAITING_PAYMENT" | "PAID" | "PAYMENT_REVIEW" | "FULFILLED" | "CANCELLED" | "EXPIRED";
export type MerchandiseOrderPayment = {
  reference: string;
  amount: string;
  currency: string;
  accepted: boolean;
  verified: boolean;
};
export type MerchandiseOrderSnapshot = {
  status: MerchandiseOrderStatus;
  paymentReference: string;
  total: string;
  currency: string;
  stockHeld: boolean;
};

export function amountInCents(value: string): number {
  // Strict decimal strings avoid binary-float equality and exponent coercion.
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) throw new Error("INVALID_MONEY");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("INVALID_MONEY");
  return cents;
}

export function merchandisePaymentDecision(order: MerchandiseOrderSnapshot, payment: MerchandiseOrderPayment): { status: MerchandiseOrderStatus; postPayment: boolean; releaseStock: boolean } {
  if (!payment.verified || payment.reference !== order.paymentReference || payment.currency !== order.currency || amountInCents(payment.amount) !== amountInCents(order.total)) throw new Error("MERCHANDISE_PAYMENT_MISMATCH");
  // A browser return, duplicate callback or later decline must never undo payment.
  if (["PAID", "PAYMENT_REVIEW", "FULFILLED"].includes(order.status)) return { status: order.status, postPayment: false, releaseStock: false };
  if (!payment.accepted) return { status: order.status, postPayment: false, releaseStock: false };
  // Late success must be recorded, but cannot resurrect released/expired stock.
  const canFulfil = order.status === "AWAITING_PAYMENT" && order.stockHeld;
  return { status: canFulfil ? "PAID" : "PAYMENT_REVIEW", postPayment: true, releaseStock: false };
}

export function merchandiseCancellationDecision(order: MerchandiseOrderSnapshot, expired = false): { status: MerchandiseOrderStatus; releaseStock: boolean } {
  if (order.status !== "AWAITING_PAYMENT") return { status: order.status, releaseStock: false };
  return { status: expired ? "EXPIRED" : "CANCELLED", releaseStock: order.stockHeld };
}

export function assertMerchandiseFulfillable(order: MerchandiseOrderSnapshot) {
  if (order.status !== "PAID" || !order.stockHeld) throw new Error("MERCHANDISE_NOT_FULFILLABLE");
}
