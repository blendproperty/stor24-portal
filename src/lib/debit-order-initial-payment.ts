import { randomUUID } from "node:crypto";
import { db } from "./db";
import { findMandateLease } from "./debit-mandate-session";
import { publicCheckoutTotal } from "./public-initial-rent";
import { isTestPayment } from "./payments/payment-evidence";
import { startPublicNetcashSandboxPayment } from "./public-netcash-payment";
import { preparePublicReservationLease } from "./public-lease-workflow";
import { debitOrderSchedule } from "./debit-order-schedule";

import { verifiedInitialReceipt, type Payment } from "./payments/upfront-receipt";
export { verifiedInitialReceipt } from "./payments/upfront-receipt";
export function initialPaymentState(payments: Payment[], amount: number) {
  if (!payments.length) return { status: "NOT_STARTED", paymentId: null, isTest: true };
  // Multiple attempts or a different amount require reconciliation, not another form.
  if (payments.length !== 1 || Number(payments[0].amount) !== amount || payments[0].currency !== "ZAR") return { status: "REVIEW_REQUIRED", paymentId: null, isTest: true };
  const payment = payments[0];
  const test = isTestPayment(payment);
  return { status: payment.status === "SUCCEEDED" && test ? "TEST_SUCCEEDED" : payment.status, paymentId: payment.id, isTest: test };
}
export async function debitOrderInitialPaymentStatus(token: string) {
  const lease = await findMandateLease(token);
  if (lease.sourceSessionId) return { status: "STAFF_REVIEW_REQUIRED", paymentId: null, isTest: false, paymentVerified: false, invoice: null, earliestCollectionDate: null };
  const amount = publicCheckoutTotal(lease.reservation);
  const account = await db.account.findUnique({ where: { accountNumber: `ST24-T-${lease.reservation.id}` }, select: { customerId: true, payments: { select: { id: true, status: true, amount: true, currency: true, environment: true, idempotencyKey: true, processedAt: true, provider: true, method: true } }, ledgerEntries: { select: { id: true, type: true, amount: true, metadata: true, reversalOfId: true } } } });
  if (account && account.customerId !== lease.reservation.customerId) throw new Error("NETCASH_ACCOUNT_CONFLICT");
  const schedule = debitOrderSchedule(lease.reservation, null, new Date().toISOString().slice(0, 10));
  const state = initialPaymentState(account?.payments ?? [], amount);
  const paymentVerified = state.status === "SUCCEEDED" && account?.payments.length === 1 && verifiedInitialReceipt(account.payments[0], account.ledgerEntries ?? []);
  return { ...state, ...(state.status === "SUCCEEDED" && !paymentVerified ? { status: "REVIEW_REQUIRED" } : {}), paymentVerified: Boolean(paymentVerified), invoice: schedule.initialPayment, earliestCollectionDate: schedule.earliestDate };
}
export async function startDebitOrderInitialPayment(token: string) {
  const lease = await findMandateLease(token);
  if (lease.sourceSessionId || lease.expiresAt <= new Date() || lease.reservation.status !== "ACTIVE") throw new Error("INITIAL_PAYMENT_REVIEW_REQUIRED");
  if (!debitOrderSchedule(lease.reservation, null, new Date().toISOString().slice(0, 10)).initialPayment) throw new Error("INITIAL_PAYMENT_REVIEW_REQUIRED");
  const same = await preparePublicReservationLease(lease.reservation.publicReference!, "DEBIT_ORDER", lease.signingToken);
  if (!same.ok || same.status !== "SIGNED") throw new Error("MANDATE_AGREEMENT_CHANGED");
  return db.$transaction(async tx => {
    // Cross-device concurrent requests must not issue two checkout forms.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`debit-initial:${lease.id}`}, 0))`;
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${lease.reservation.id} FOR UPDATE`;
    const current = await findMandateLease(token);
    if (current.id !== lease.id || current.expiresAt <= new Date() || JSON.stringify(current.reservation) !== JSON.stringify(lease.reservation)) throw new Error("MANDATE_AGREEMENT_CHANGED");
    const state = await debitOrderInitialPaymentStatus(token);
    if (state.status !== "NOT_STARTED") throw new Error("INITIAL_PAYMENT_ALREADY_STARTED");
    const result = await startPublicNetcashSandboxPayment(lease.reservation.publicReference!, randomUUID(), true, lease.signingToken);
    if (!result.ok) throw new Error(result.code);
    return result;
  }, { timeout: 30_000 });
}
