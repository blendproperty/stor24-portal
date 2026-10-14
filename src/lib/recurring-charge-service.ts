import { db } from "@/lib/db";
import { facilityWhere, requireFacility, type RequestScope } from "./scope";
import type { ReportParameters } from "./reporting";
import { filterRecurringRows, recurringChargeRows, recurringPeriod } from "./recurring-charge-report";
import { rentRatesForBilling } from "./rent-review-service";
import type { ReportRow } from "./report-data-service";

export async function recurringChargeReport(scope: RequestScope, parameters: ReportParameters) {
  if (parameters.facilityId) await requireFacility(scope, parameters.facilityId);
  const period = recurringPeriod(parameters.from, parameters.to), snapshotTakenAt = new Date().toISOString();
  return db.$transaction(async tx => {
    const accounts = await tx.account.findMany({ where: { customer: { organisationId: scope.organisationId }, tenancy: {
      facility: { AND: [facilityWhere(scope), ...(parameters.facilityId ? [{id:parameters.facilityId}] : [])] }, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } },
      orderBy: { id: "asc" }, take: 501, include: { customer: { select: { firstName: true, lastName: true, companyName: true } }, tenancy: { include: {
        facility: { select: { name: true, code:true } }, occupancies: { where: { status: { notIn: ["PENDING", "CANCELLED"] } }, include: { unit: { select: { number: true, facilityId: true } } }, orderBy: { id: "asc" }, take: 101 }, insuranceEnrollment: true } } } });
    if (accounts.length > 500) throw Error("RECURRING_REPORT_LIMIT");
    const rows: ReportRow[] = [];
    for (const account of accounts) {
      const tenancy = account.tenancy!;
      if (tenancy.customerId !== account.customerId || tenancy.occupancies.length > 100 || tenancy.occupancies.some(o=>o.unit.facilityId !== tenancy.facilityId)) throw Error("RECURRING_SOURCE_REVIEW");
      const profile = await tx.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, domain: "MONTHLY_BILLING", name: account.id } });
      const invoice = await tx.document.findUnique({ where: { idempotencyKey: `monthly-invoice:${account.id}:${period}` }, select: { tenancyId: true, externalId: true } });
      if (invoice && invoice.tenancyId !== tenancy.id) throw Error("RECURRING_SOURCE_REVIEW");
      const rates = await rentRatesForBilling(tx, scope.organisationId, tenancy.facilityId, tenancy.occupancies, period);
      rows.push(...recurringChargeRows({ facility: tenancy.facility.name, facilityId:tenancy.facilityId, facilityCode:tenancy.facility.code, account: account.accountNumber,
        customer: account.customer.companyName || [account.customer.firstName, account.customer.lastName].filter(Boolean).join(" "),
        units: tenancy.occupancies.filter(o => o.startDate <= new Date(`${parameters.to}T23:59:59+02:00`) && (!o.endDate || o.endDate > new Date(`${period}-01T00:00:00+02:00`))).map(o => o.unit.number).join(" | "),
        paymentMethod: tenancy.paymentMethod, currency: account.currency, plan: profile?.config, planReady: profile?.status === "READY", planUpdatedAt: profile?.updatedAt.toISOString() ?? null,
        invoice: invoice?.externalId ?? null, occupancies: tenancy.occupancies.map(o => ({ ...o, number: o.unit.number, monthlyRate: rates.get(o.id)! })),
        insurance: tenancy.insuranceEnrollment ? { ...tenancy.insuranceEnrollment, monthlyPremium: tenancy.insuranceEnrollment.monthlyPremium === null ? null : Number(tenancy.insuranceEnrollment.monthlyPremium) } : null }, period, snapshotTakenAt));
      if (rows.length > 5000) throw Error("RECURRING_REPORT_LIMIT");
    }
    return filterRecurringRows(rows, parameters);
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
