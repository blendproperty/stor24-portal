import { db } from "@/lib/db";
import { nextBillingPeriod } from "@/lib/monthly-billing-policy";
import { previewNextMonthForReview, postScheduledNextBilling } from "@/lib/monthly-billing-service";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { scheduledInvoiceDate } from "@/lib/invoice-schedule";

// No fallback to the legacy job: this separate run is explicitly enabled and date-bound.
export async function runNextMonthInvoices(now = new Date(), organisationId?: string) {
  if (process.env.NEXT_MONTH_INVOICING_ENABLED !== "true") throw new Error("BILLING_SCHEDULE_DISABLED");
  const period = nextBillingPeriod(now);
  const accounts = await db.account.findMany({ where: { ...(organisationId ? { customer: { organisationId } } : {}), tenancy: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } }, select: { id: true, customer: { select: { organisationId: true } }, tenancy: { select: { facilityId: true } } }, orderBy: { id: "asc" } });
  const summary: { period: string; generated: number; alreadyGenerated: number; exceptions: { accountId: string; code: string }[] } = { period, generated: 0, alreadyGenerated: 0, exceptions: [] };
  for (const account of accounts) {
    const scope = { organisationId: account.customer.organisationId, userId: "", facilityIds: [account.tenancy!.facilityId], unrestrictedFacilities: false };
    try {
      if (southAfricaDateKey(now) !== await scheduledInvoiceDate(db, scope.organisationId, account.tenancy!.facilityId, now)) continue;
      const draft = await previewNextMonthForReview(scope, account.id);
      if (draft.period !== period) throw new Error("BILLING_PREVIEW_CHANGED");
      await postScheduledNextBilling(scope, account.id, period, draft.fingerprint, now);
      summary.generated++;
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("BILLING_") ? error.message : "BILLING_RETRY_REVIEW_REQUIRED";
      if (code === "BILLING_ALREADY_POSTED") summary.alreadyGenerated++;
      else summary.exceptions.push({ accountId: account.id, code });
    }
  }
  return summary;
}
