import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "@/lib/scope";
import { billingPlanSchema, calculateMonthlyBill, currentBillingPeriod, periodDates, type BillingPlan } from "./monthly-billing-policy";
import { isTestPayment } from "./payments/payment-evidence";
import { renderInvoiceHtml } from "./finance/invoice-renderer";
import { getBillingDocumentCompanyDetails } from "./finance/billing-document-config";

const DOMAIN = "MONTHLY_BILLING";
type Client = Prisma.TransactionClient;
function accountWhere(scope: RequestScope, accountId?: string): Prisma.AccountWhereInput {
  return { ...(accountId ? { id: accountId } : {}), customer: { organisationId: scope.organisationId }, tenancy: { facility: { organisationId: scope.organisationId }, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) } };
}
export async function monthlyBillingAccounts(scope: RequestScope) {
  return db.account.findMany({ where: accountWhere(scope), select: { id: true, accountNumber: true, customer: { select: { companyName: true, firstName: true, lastName: true } }, tenancy: { select: { facilityId: true, status: true, facility: { select: { name: true } } } } }, orderBy: { accountNumber: "asc" } });
}
async function context(client: Client, scope: RequestScope, accountId: string) {
  const account = await client.account.findFirst({ where: accountWhere(scope, accountId), include: { customer: true, tenancy: { include: { facility: true, occupancies: { include: { unit: true }, orderBy: { id: "asc" } }, insuranceEnrollment: true } } } });
  if (!account?.tenancy || account.tenancy.customerId !== account.customerId) throw new Error("BILLING_ACCOUNT_NOT_FOUND");
  const profile = await client.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: account.tenancy.facilityId, domain: DOMAIN, name: accountId } });
  return { account, tenancy: account.tenancy, profile };
}
export async function getMonthlyBillingPlan(scope: RequestScope, accountId: string) {
  const { profile } = await context(db, scope, accountId);
  return profile?.status === "READY" ? billingPlanSchema.parse(profile.config) : null;
}
export async function monthlyBillingInvoices(scope: RequestScope, accountId: string) {
  const { tenancy } = await context(db, scope, accountId);
  return db.document.findMany({ where: { tenancyId: tenancy.id, type: "INVOICE", idempotencyKey: { startsWith: "monthly-invoice:" } }, select: { id: true, externalId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 60 });
}
export async function saveMonthlyBillingPlan(scope: RequestScope, accountId: string, value: unknown) {
  const plan = billingPlanSchema.parse(value);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    const { tenancy, profile } = await context(tx, scope, accountId);
    const result = await tx.configurationProfile.upsert({ where: { organisationId_facilityId_domain_name: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, domain: DOMAIN, name: accountId } }, create: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, domain: DOMAIN, name: accountId, status: "READY", config: plan }, update: { config: plan, status: "READY" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, actorId: scope.userId, action: "billing.plan_approved", entityType: "Account", entityId: accountId, before: profile?.config ?? Prisma.JsonNull, after: plan } });
    return result.config as unknown as BillingPlan;
  });
}
async function preview(client: Client, scope: RequestScope, accountId: string, period: string) {
  const dates = periodDates(period);
  if (period > currentBillingPeriod()) throw new Error("BILLING_FUTURE_PERIOD");
  const { account, tenancy, profile } = await context(client, scope, accountId);
  if (!profile || profile.status !== "READY") throw new Error("BILLING_PLAN_REQUIRED");
  if (!["ACTIVE", "NOTICE_GIVEN"].includes(tenancy.status)) throw new Error("BILLING_TENANCY_NOT_ACTIVE");
  if (account.currency !== "ZAR") throw new Error("BILLING_CURRENCY_UNSUPPORTED");
  const plan = billingPlanSchema.parse(profile.config);
  const entries = await client.ledgerEntry.findMany({ where: { accountId }, orderBy: { id: "asc" } });
  if (entries.some(entry => entry.externalRef === `RENT-${period}`)) throw new Error("BILLING_ALREADY_POSTED");
  // An existing initial charge/manual adjustment cannot silently be charged again.
  const end = new Date(`${dates.end}T23:59:59.999+02:00`);
  if (entries.some(entry => ["CHARGE", "CREDIT", "REVERSAL", "WRITE_OFF"].includes(entry.type) && entry.effectiveAt >= dates.effectiveAt && entry.effectiveAt <= end)) throw new Error("BILLING_EXISTING_CHARGES_REVIEW");
  const payments = await client.payment.findMany({ where: { accountId }, orderBy: { id: "asc" } });
  const tests = payments.filter(isTestPayment);
  if (entries.some(entry => entry.type === "PAYMENT" && tests.some(payment => entry.externalRef === payment.idempotencyKey || (entry.metadata as { paymentId?: string } | null)?.paymentId === payment.id))) throw new Error("BILLING_TEST_PAYMENT_REVIEW");
  const result = calculateMonthlyBill(period, plan, tenancy.occupancies.filter(o => !["PENDING", "CANCELLED"].includes(o.status)).map(o => ({ id: o.id, number: o.unit.number, monthlyRate: Number(o.monthlyRate), startDate: o.startDate, endDate: o.endDate })), tenancy.insuranceEnrollment ? { ...tenancy.insuranceEnrollment, monthlyPremium: tenancy.insuranceEnrollment.monthlyPremium === null ? null : Number(tenancy.insuranceEnrollment.monthlyPremium) } : null);
  const fingerprint = createHash("sha256").update(JSON.stringify({ account, profile, entries, payments, result })).digest("hex");
  return { ...result, fingerprint, accountNumber: account.accountNumber, accountId, customerName: account.customer.companyName || [account.customer.firstName, account.customer.lastName].filter(Boolean).join(" ") || "Customer", facilityName: tenancy.facility.name, tenancyId: tenancy.id, facilityId: tenancy.facilityId, balance: account.balance.toString(), approvalReference: plan.approvalReference };
}
export async function previewMonthlyBilling(scope: RequestScope, accountId: string, period: string) { return preview(db, scope, accountId, period); }
export async function postMonthlyBilling(scope: RequestScope, accountId: string, period: string, fingerprint: string, actorId: string | null = scope.userId) {
  // Documents snapshot the configured company information; no email or provider call occurs.
  const { tenancy } = await context(db, scope, accountId);
  const company = await getBillingDocumentCompanyDetails(scope.organisationId, tenancy.facilityId);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    const bill = await preview(tx, scope, accountId, period);
    if (bill.fingerprint !== fingerprint) throw new Error("BILLING_PREVIEW_CHANGED");
    const invoiceNumber = `INV-${period.replace("-", "")}-${bill.accountNumber}`;
    const posted = [];
    for (const [index, line] of bill.lines.entries()) {
      posted.push(await tx.ledgerEntry.create({ data: { accountId, type: line.type, amount: line.amount, taxAmount: line.taxAmount, description: line.description, effectiveAt: periodDates(period).effectiveAt, externalRef: index === 0 ? `RENT-${period}` : `BILL-${period}-${line.key}`, createdById: actorId, metadata: { billingPeriod: period, invoiceNumber, approvalReference: bill.approvalReference, fingerprint: bill.fingerprint } } }));
    }
    const account = await tx.account.update({ where: { id: accountId }, data: { balance: { increment: bill.total } } });
    const html = renderInvoiceHtml({ invoiceNumber, issueDate: periodDates(period).effectiveAt, facilityName: bill.facilityName, company, customerName: bill.customerName, accountNumber: bill.accountNumber, currentBalance: account.balance.toString(), lines: posted.map(line => ({ id: line.id, description: line.description, effectiveAt: line.effectiveAt, amount: Number(line.amount) * (line.type === "CREDIT" ? -1 : 1), taxAmount: Number(line.taxAmount) * (line.type === "CREDIT" ? -1 : 1) })) });
    const sha256 = createHash("sha256").update(html).digest("hex");
    const document = await tx.document.create({ data: { tenancyId: bill.tenancyId, type: "INVOICE", status: "GENERATED", storageKey: `inline:${sha256}`, content: html, sha256, externalId: invoiceNumber, idempotencyKey: `monthly-invoice:${accountId}:${period}` } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: bill.facilityId, actorId, action: "billing.month_posted", entityType: "Account", entityId: accountId, after: { period, invoiceNumber, documentId: document.id, total: bill.total, taxTotal: bill.taxTotal, fingerprint } } });
    return { documentId: document.id, invoiceNumber, total: bill.total };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
