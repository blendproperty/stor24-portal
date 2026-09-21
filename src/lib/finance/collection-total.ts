import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { isTestPayment } from "@/lib/payments/payment-evidence";
/** Preserve original receipts in their original period; deduct corrections when posted. */
export async function netCollectionTotal(scope: RequestScope, from: Date, to?: Date) {
  const dates = { gte: from, ...(to ? { lt: to } : {}) };
  const [payments, corrections] = await Promise.all([
    db.payment.findMany({ where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "REVERSED"] }, processedAt: dates, account: { customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(scope) } } }, select: { amount: true, status: true, environment: true, idempotencyKey: true } }),
    db.financialAdjustment.aggregate({ where: { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }), status: "POSTED", kind: { in: ["REFUND", "REVERSAL"] }, postedAt: dates }, _sum: { amount: true } }),
  ]);
  return (payments.filter(p => !isTestPayment(p)).reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0) - Math.round(Number(corrections._sum.amount ?? 0) * 100)) / 100;
}
