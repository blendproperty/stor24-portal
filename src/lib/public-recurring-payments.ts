import { db } from "./db";
import { publicCheckoutTotal } from "./public-initial-rent";
import { verifiedInitialReceipt, type Payment, type Receipt } from "./payments/upfront-receipt";
import { isTestPayment } from "./payments/payment-evidence";
import { readRentalPlan, monthlyPaymentsRelevant } from "./public-rental-plan";
import { mandatePolicy } from "./payments/netcash-mandate-policy";
import { debitOrderSchedule } from "./debit-order-schedule";
import { southAfricaDateKey } from "./south-africa-time";

type Booking = Parameters<typeof publicCheckoutTotal>[0] & { id: string; customerId: string };
export function recurringUpfrontEvidence(payments: Payment[], receipts: Receipt[], amount: number) {
  const successful = payments.filter(p => p.status === "SUCCEEDED");
  if (successful.length !== 1 || payments.some(p => !["SUCCEEDED", "FAILED", "CANCELLED"].includes(p.status))) return { ready: false, isTest: false, paymentId: null };
  const p = successful[0];
  if (Number(p.amount) !== amount || p.currency !== "ZAR" || p.provider !== "NETCASH" || p.method !== "PAY_NOW" || !p.processedAt || receipts.some(r => r.type === "REFUND" || r.type === "REVERSAL")) return { ready: false, isTest: false, paymentId: null };
  const test = isTestPayment(p);
  return { ready: test || verifiedInitialReceipt(p, receipts), isTest: test, paymentId: p.id };
}
export async function paidUpfrontEvidence(reservation: Booking) {
  const account = await db.account.findUnique({ where: { accountNumber: `ST24-T-${reservation.id}` }, select: { customerId: true, payments: { select: { id: true, status: true, amount: true, currency: true, environment: true, idempotencyKey: true, processedAt: true, provider: true, method: true } }, ledgerEntries: { select: { id: true, type: true, amount: true, metadata: true, reversalOfId: true } } } });
  if (account && account.customerId !== reservation.customerId) throw new Error("NETCASH_ACCOUNT_CONFLICT");
  return recurringUpfrontEvidence(account?.payments ?? [], account?.ledgerEntries ?? [], publicCheckoutTotal(reservation));
}
export async function recurringLease(token: string) {
  const lease = await db.publicReservationLease.findUnique({ where: { signingToken: token }, include: { mandate: true, reservation: { include: { customer: true, facility: true, unit: true, packageSelection: true } } } });
  if (!lease || lease.status !== "SIGNED" || !lease.signedAt || !["CARD", "EFT"].includes(lease.paymentMethod) || !lease.reservation.customer.emailVerifiedAt) throw new Error("RECURRING_BOOKING_UNAVAILABLE");
  return lease;
}
export async function recurringPaymentStatus(token: string) {
  const lease = await recurringLease(token);
  const payment = await paidUpfrontEvidence(lease.reservation);
  const plan = readRentalPlan(lease.reservation.rentalPlan);
  const policy = mandatePolicy();
  const scoped = policy?.organisationId === lease.reservation.customer.organisationId ? policy : null;
  const schedule = debitOrderSchedule(lease.reservation, lease.debitOrderPreferences, southAfricaDateKey(new Date()), scoped?.allowedDays, !!lease.mandate);
  return { reference: lease.reservation.publicReference, expectedDuration: plan.expectedDuration, futurePaymentMethod: plan.futurePaymentMethod, offered: monthlyPaymentsRelevant(lease.reservation.rentalPlan), paymentReady: payment.ready, isTest: payment.isTest, monthlyRateZar: Number(lease.reservation.quotedRate), allowedDays: scoped?.allowedDays ?? [], setupEnabled: payment.isTest && process.env.NETCASH_MANDATE_SETUP_ENABLED === "true" && !!scoped && lease.reservation.status === "ACTIVE" && lease.expiresAt > new Date() && lease.reservation.customer.type === "INDIVIDUAL" && !lease.reservation.customer.companyName, schedule, preferences: lease.debitOrderPreferences, mandateStarted: !!lease.mandate, collectionEnabled: false };
}
export async function chooseFuturePayments(token: string, choice: "DEBIT_ORDER" | "MANUAL") {
  const lease = await recurringLease(token);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${lease.reservationId} FOR UPDATE`;
    const current = await recurringLease(token);
    const payment = await paidUpfrontEvidence(current.reservation);
    if (current.reservation.status !== "ACTIVE" || current.expiresAt <= new Date() || !payment.ready) throw new Error("UPFRONT_PAYMENT_REQUIRED");
    if (choice === "DEBIT_ORDER" && !monthlyPaymentsRelevant(current.reservation.rentalPlan)) throw new Error("RECURRING_NOT_REQUIRED");
    if (current.mandate && choice !== "DEBIT_ORDER") throw new Error("EXISTING_MANDATE_REVIEW_REQUIRED");
    const old = readRentalPlan(current.reservation.rentalPlan);
    if (old.futurePaymentMethod === choice) return { choice, idempotent: true };
    const choiceAt = new Date().toISOString();
    await tx.reservation.update({ where: { id: current.reservationId }, data: { rentalPlan: { version: 1, ...old, futurePaymentMethod: choice, choiceAt } } });
    await tx.auditEvent.create({ data: { organisationId: current.reservation.customer.organisationId, facilityId: current.reservation.facilityId, action: "public_booking.future_payment_choice", entityType: "Reservation", entityId: current.reservationId, after: { choice, expectedDuration: old.expectedDuration, paymentChecked: true, paymentId: payment.paymentId, isTest: payment.isTest, bankAuthorityGranted: false, collectionEnabled: false } } });
    return { choice, idempotent: false };
  });
}
