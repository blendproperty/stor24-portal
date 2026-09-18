import { db } from "@/lib/db";
import { isTestPayment } from "./payment-evidence";

/** Read-only quarantine of historical sandbox ledger contamination; never erase accounting history. */
export async function testPaymentReviewAccounts(accountIds: string[]) {
  if (!accountIds.length) return new Set<string>();
  const payments = await db.payment.findMany({ where: { accountId: { in: accountIds } }, select: { id: true, accountId: true, status: true, idempotencyKey: true, environment: true } });
  const tests = payments.filter(isTestPayment);
  if (!tests.length) return new Set<string>();
  const entries = await db.ledgerEntry.findMany({ where: { accountId: { in: [...new Set(tests.map(p => p.accountId))] }, type: "PAYMENT" }, select: { accountId: true, externalRef: true, metadata: true } });
  return new Set(entries.filter(entry => tests.some(payment => payment.accountId === entry.accountId && ((entry.metadata as { paymentId?: string } | null)?.paymentId === payment.id || entry.externalRef === payment.idempotencyKey))).map(entry => entry.accountId));
}
