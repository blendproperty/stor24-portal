import { db } from "@/lib/db";
import { isTestPayment } from "./payment-evidence";

/** Called only after server-to-server provider verification. Serialises callbacks and staff handover. */
export async function settleVerifiedBookingPayment(paymentId: string, evidence: { reference: string; amount: number; accepted: boolean; requestTrace: string }) {
  return db.$transaction(async tx => {
    const target = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { accountId: true } });
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${target.accountId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.provider !== "NETCASH" || payment.providerRef !== evidence.reference || payment.currency !== "ZAR" || Number(payment.amount) !== evidence.amount) throw new Error("PAYMENT_VERIFICATION_MISMATCH");
    const test = isTestPayment(payment);
    if (payment.status === "SUCCEEDED" || payment.status === "TEST_SUCCEEDED") return { financial: !test, terminal: true };
    if (!test && payment.environment !== "live") throw new Error("PAYMENT_ENVIRONMENT_REVIEW_REQUIRED");
    if (!evidence.accepted) return { financial: false, terminal: false }; // May be asynchronous EFT; never downgrade success.
    await tx.payment.update({ where: { id: paymentId }, data: { status: test ? "TEST_SUCCEEDED" : "SUCCEEDED", processedAt: new Date(), failureCode: null } });
    if (test) return { financial: false, terminal: true }; // No ledger, balance, receipt or finance export.
    await tx.ledgerEntry.create({ data: { accountId: payment.accountId, type: "PAYMENT", amount: payment.amount, description: `Netcash payment received (${payment.method})`, effectiveAt: new Date(), externalRef: `netcash-payment:${payment.id}`, metadata: { provider: "NETCASH", paymentId: payment.id, requestTrace: evidence.requestTrace, verifiedStatus: true, environment: payment.environment } } });
    await tx.account.update({ where: { id: payment.accountId }, data: { balance: { decrement: payment.amount } } });
    return { financial: true, terminal: true };
  });
}
