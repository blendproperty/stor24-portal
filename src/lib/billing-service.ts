import { db } from "@/lib/db";
import { billingPeriodSchema } from "./monthly-billing-policy";
import { postMonthlyBilling, previewMonthlyBilling } from "./monthly-billing-service";
import { runLegacyMonthlyBilling } from "./legacy-monthly-billing";

export type MonthlyBillingSummary = { period: string; charged: number; skipped: number; totalAmount: string; occupanciesConsidered: number; exceptions: { accountId: string; code: string }[] };
/** Explicit opt-in only. Uses the same approved plans and atomic posting as staff. */
export async function runMonthlyBilling(period: string): Promise<MonthlyBillingSummary> {
  if (!billingPeriodSchema.safeParse(period).success) throw new Error("INVALID_PERIOD");
  if (process.env.MONTHLY_BILLING_PAUSED === "true") throw new Error("BILLING_AUTOMATION_DISABLED");
  // Preserve the existing live schedule until an explicit, approved cut-over.
  if (process.env.MONTHLY_BILLING_AUTOMATION_ENABLED !== "true") return { ...await runLegacyMonthlyBilling(period), exceptions: [] };
  const accounts = await db.account.findMany({ where: { tenancy: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } }, include: { customer: { select: { organisationId: true } }, tenancy: { select: { facilityId: true } } } });
  const summary: MonthlyBillingSummary = { period, charged: 0, skipped: 0, totalAmount: "0.00", occupanciesConsidered: accounts.length, exceptions: [] };
  let cents = 0;
  for (const account of accounts) {
    const scope = { organisationId: account.customer.organisationId, userId: "", facilityIds: [account.tenancy!.facilityId], unrestrictedFacilities: false };
    try {
      const preview = await previewMonthlyBilling(scope, account.id, period);
      const result = await postMonthlyBilling(scope, account.id, period, preview.fingerprint, null);
      summary.charged++; cents += Math.round(result.total * 100);
    } catch (error) {
      summary.skipped++;
      const code = error instanceof Error && error.message.startsWith("BILLING_") ? error.message : "BILLING_RETRY_REVIEW_REQUIRED";
      if (code !== "BILLING_ALREADY_POSTED") summary.exceptions.push({ accountId: account.id, code });
    }
  }
  summary.totalAmount = (cents / 100).toFixed(2);
  return summary;
}
