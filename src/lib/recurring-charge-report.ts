import { billingPlanSchema, calculateMonthlyBill, currentBillingPeriod, periodDates, type BillingOccupancy, type BillingInsurance } from "./monthly-billing-policy";
import type { ReportParameters } from "./reporting";
import type { ReportRow } from "./report-data-service";

export function recurringPeriod(from: string, to: string, now = new Date()) {
  const period = from.slice(0, 7), current = currentBillingPeriod(now);
  const months = (Number(period.slice(0, 4)) - Number(current.slice(0, 4))) * 12 + Number(period.slice(5)) - Number(current.slice(5));
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period) || from !== `${period}-01` || to !== periodDates(period).end || period !== to.slice(0, 7) || from > to || months < 0 || months > 12) throw Error("RECURRING_PERIOD_INVALID");
  return period;
}
export type RecurringSource = {
  facility: string; facilityId: string; facilityCode: string; account: string; customer: string; units: string; paymentMethod: string | null;
  currency: string; plan: unknown; planReady: boolean; planUpdatedAt: string | null;
  invoice: string | null; occupancies: BillingOccupancy[]; insurance: BillingInsurance | null;
};
/** Current approved-plan projection, never a receipt, arrears allocation or collection instruction. */
export function recurringChargeRows(source: RecurringSource, period: string, snapshotTakenAt: string): ReportRow[] {
  const base = { snapshotTakenAt, basis: "Current approved plan projection", facility: source.facility, facilityId:source.facilityId, facilityCode:source.facilityCode, account: source.account,
    customer: source.customer, units: source.units, paymentMethod: source.paymentMethod ?? "UNRECORDED", currency: source.currency,
    period, frequency: "MONTHLY", planUpdatedAt: source.planUpdatedAt, invoice: source.invoice };
  const blocked = (review: string, status = "REVIEW") => [{ ...base, status, category: null, charge: null, description: null, amount: null, includedTax: null, approvalReference: null, firstPeriod: null, proration: null, review }];
  if (source.currency !== "ZAR") return blocked("Unsupported currency");
  const parsed = billingPlanSchema.safeParse(source.plan);
  if (!source.planReady || !parsed.success) return blocked("Missing or invalid approved billing plan");
  if (period < parsed.data.firstPeriod) return blocked("Approved schedule has not started", "NOT_STARTED");
  try {
    const bill = calculateMonthlyBill(period, parsed.data, source.occupancies, source.insurance);
    return bill.lines.map(line => ({ ...base, status: "READY", category: line.key.startsWith("rent:") ? "RENT" : line.key === "discount" ? "DISCOUNT" : line.key === "insurance" ? "INSURANCE" : "OTHER",
      charge: line.key, description: line.description, amount: ((line.type === "CREDIT" ? -1 : 1) * line.amount).toFixed(2),
      includedTax: ((line.type === "CREDIT" ? -1 : 1) * line.taxAmount).toFixed(2), approvalReference: parsed.data.approvalReference,
      firstPeriod: parsed.data.firstPeriod, proration: parsed.data.proration, review: null }));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("BILLING_")) throw error;
    return blocked(error.message.replace(/^BILLING_/, "").replaceAll("_", " "));
  }
}
export function filterRecurringRows(rows: ReportRow[], p: ReportParameters) {
  const search = p.recurringSearch?.toLowerCase();
  return rows.filter(row => (!p.recurringStatus || row.status === p.recurringStatus) && (!p.recurringPaymentMethod || row.paymentMethod === p.recurringPaymentMethod) &&
    (!p.recurringCategory || row.category === p.recurringCategory) && (!search || [row.account, row.customer, row.units].some(v => String(v ?? "").toLowerCase().includes(search))));
}
