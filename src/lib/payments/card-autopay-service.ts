import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { billingPlanSchema, calculateMonthlyBill } from "@/lib/monthly-billing-policy";
import { rentRatesForBilling } from "@/lib/rent-review-service";
import { isTestPayment } from "./payment-evidence";
import { CARD_AUTOPAY_TERMS_VERSION, cardAutopayPeriods, cardAutopayScheduleSchema, fixedCardAutopayAmount, cardAutopayFingerprint, cardAutopayRequestText } from "./card-autopay-policy";
import { CARD_SUBSCRIPTION_DOMAIN, CARD_SUBSCRIPTION_OPEN_STATUSES, CARD_REQUEST_HISTORY_DOMAIN, cardSourceHash } from "./card-autopay-enrollment-policy";
export type CardAutopayCustomer = { organisationId: string; email: string; customerIds: string[] };
type Client = Prisma.TransactionClient;
const DOMAIN = "CARD_AUTOPAY_REQUEST";
export async function prepareCardAutopay(client: Client, session: CardAutopayCustomer, accountId: string, value: unknown, now: Date, allowUnpostedTests = false) {
  const schedule = cardAutopayScheduleSchema.parse(value);
  if (schedule.cycles > 12) throw new Error("CARD_AUTOPAY_DURATION_REVIEW");
  const periods = cardAutopayPeriods(schedule, now);
  const account = await client.account.findFirst({
    where: { id: accountId, customer: tenantCustomerScope(session), tenancy: { facility: { organisationId: session.organisationId } } },
    include: { tenancy: { include: {
      occupancies: { include: { unit: true }, orderBy: { id: "asc" } },
      insuranceEnrollment: true,
      mandateSession: { select: { mandate: { select: { status: true } } } },
      documents: { where: { type: "LEASE_AGREEMENT", status: "SIGNED", signedAt: { not: null } }, select: { id: true, signedAt: true, externalId: true } },
      reservation: { select: { publicLease: { select: { id: true, status: true, signedAt: true, mandate: { select: { status: true } } } } } },
    } } },
  });
  const tenancy = account?.tenancy;
  if (!account || !tenancy || tenancy.customerId !== account.customerId || tenancy.facilityId === null) throw new Error("TENANT_NOT_FOUND");
  if (tenancy.status !== "ACTIVE" || tenancy.endDate || tenancy.noticeDate || account.currency !== "ZAR") throw new Error("CARD_AUTOPAY_ACCOUNT_INELIGIBLE");
  if (tenancy.paymentMethod === "DEBIT_ORDER" || tenancy.mandateSession?.mandate?.status === "SIGNED" || tenancy.reservation?.publicLease?.mandate?.status === "SIGNED" || await client.debitOrderInstruction.count({ where: { accountId } })) throw new Error("CARD_AUTOPAY_OTHER_COLLECTION_REVIEW");
  const publicLease = tenancy.reservation?.publicLease;
  if (!tenancy.documents.length && !(publicLease?.status === "SIGNED" && publicLease.signedAt)) throw new Error("CARD_AUTOPAY_SIGNED_LEASE_REQUIRED");
  const profile = await client.configurationProfile.findFirst({ where: { organisationId: session.organisationId, facilityId: tenancy.facilityId, domain: "MONTHLY_BILLING", name: accountId, status: "READY" } });
  if (!profile) throw new Error("CARD_AUTOPAY_APPROVED_BILLING_REQUIRED");
  const plan = billingPlanSchema.parse(profile.config);
  const payments = await client.payment.findMany({ where: { accountId } });
  if (!allowUnpostedTests && payments.some(isTestPayment)) throw new Error("TEST_PAYMENT_RECONCILIATION_REQUIRED");
  const entries = await client.ledgerEntry.findMany({ where: { accountId }, orderBy: { id: "asc" } });
  if (entries.some(entry => payments.filter(isTestPayment).some(payment => entry.externalRef === payment.idempotencyKey || (entry.metadata as { paymentId?: string } | null)?.paymentId === payment.id))) throw new Error("TEST_PAYMENT_RECONCILIATION_REQUIRED");
  // Do not assume an invoice, balance or payment date proves a period is unpaid.
  // Ambiguous forward charges or a credit balance require independent financial review.
  if (Number(account.balance) < 0 || entries.some(e => ["CHARGE", "CREDIT", "REVERSAL", "WRITE_OFF"].includes(e.type) && e.effectiveAt >= new Date(schedule.startDate + "T00:00:00+02:00"))) throw new Error("CARD_AUTOPAY_PREPAID_REVIEW");
  const occupancies = tenancy.occupancies.filter(o => o.status === "ACTIVE" && !o.endDate);
  if (occupancies.length !== 1 || occupancies[0].unit.facilityId !== tenancy.facilityId) throw new Error("CARD_AUTOPAY_OCCUPANCY_REVIEW");
  const bills = [];
  for (const period of periods) {
    const rates = await rentRatesForBilling(client, session.organisationId, tenancy.facilityId, occupancies, period);
    bills.push(calculateMonthlyBill(period, plan, occupancies.map(o => ({ id: o.id, number: o.unit.number, monthlyRate: rates.get(o.id)!, startDate: o.startDate, endDate: o.endDate })), tenancy.insuranceEnrollment ? { ...tenancy.insuranceEnrollment, monthlyPremium: tenancy.insuranceEnrollment.monthlyPremium === null ? null : Number(tenancy.insuranceEnrollment.monthlyPremium) } : null));
  }
  const monthlyAmount = fixedCardAutopayAmount(bills.map(b => b.total));
  const text = cardAutopayRequestText(monthlyAmount, schedule);
  const source = { organisationId: session.organisationId, accountId, customerId: account.customerId, tenancyId: tenancy.id, facilityId: tenancy.facilityId, accountUpdatedAt: account.updatedAt.toISOString(), tenancyUpdatedAt: tenancy.updatedAt.toISOString(), documents: tenancy.documents, publicLease, profile: { config: profile.config, updatedAt: profile.updatedAt.toISOString() }, entries, payments, bills, schedule, termsVersion: CARD_AUTOPAY_TERMS_VERSION, requestText: text };
  return { accountId, accountNumber: account.accountNumber, facilityId: tenancy.facilityId, tenancyId: tenancy.id, customerId: account.customerId, monthlyAmount, currency: "ZAR", schedule, fingerprint: cardAutopayFingerprint(source), termsVersion: CARD_AUTOPAY_TERMS_VERSION, requestText: text, providerEnrollmentAvailable: false as const };
}
export function previewCardAutopayRequest(session: CardAutopayCustomer, accountId: string, value: unknown, now = new Date(), allowUnpostedTests = false) { return prepareCardAutopay(db, session, accountId, value, now, allowUnpostedTests); }
export async function withdrawCardAutopayRequest(session: CardAutopayCustomer, accountId: string, requestId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    const account = await tx.account.findFirst({ where: { id: accountId, customer: tenantCustomerScope(session), tenancy: { facility: { organisationId: session.organisationId } } }, select: { tenancy: { select: { facilityId: true } } } });
    if (!account?.tenancy) throw new Error("TENANT_NOT_FOUND");
    if (await tx.configurationProfile.count({ where: { organisationId: session.organisationId, domain: CARD_SUBSCRIPTION_DOMAIN, status: { in: CARD_SUBSCRIPTION_OPEN_STATUSES }, config: { path: ["accountId"], equals: accountId } } })) throw Error("CARD_AUTOPAY_PROVIDER_CANCELLATION_REQUIRED");
    const record = await tx.configurationProfile.findFirst({ where: { id: requestId, organisationId: session.organisationId, facilityId: account.tenancy.facilityId, domain: DOMAIN, name: accountId } });
    if (!record) throw new Error("TENANT_NOT_FOUND");
    if (record.status === "WITHDRAWN") return { id: record.id, status: "WITHDRAWN", providerEnrollmentAvailable: false };
    if (record.status !== "REQUESTED") throw new Error("CARD_AUTOPAY_PROVIDER_CANCELLATION_REQUIRED");
    await tx.configurationProfile.update({ where: { id: record.id }, data: { status: "WITHDRAWN" } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: account.tenancy.facilityId, action: "card_autopay.request_withdrawn", entityType: "Account", entityId: accountId, after: { requestId: record.id, status: "WITHDRAWN", providerEnrollmentAvailable: false } } });
    return { id: record.id, status: "WITHDRAWN", providerEnrollmentAvailable: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function saveCardAutopayRequest(session: CardAutopayCustomer, accountId: string, value: unknown, fingerprint: string, accepted: boolean, now = new Date(), allowUnpostedTests = false) {
  if (accepted !== true) throw new Error("CARD_AUTOPAY_REQUEST_NOT_ACCEPTED");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    const preview = await prepareCardAutopay(tx, session, accountId, value, now, allowUnpostedTests);
    if (preview.fingerprint !== fingerprint) throw new Error("CARD_AUTOPAY_PREVIEW_CHANGED");
    const key = { organisationId: session.organisationId, facilityId: preview.facilityId, domain: DOMAIN, name: accountId };
    const existing = await tx.configurationProfile.findUnique({ where: { organisationId_facilityId_domain_name: key } });
    if (existing) {
      const previous = existing.config as { fingerprint?: string };
      if (existing.status === "REQUESTED" && previous.fingerprint === fingerprint) return { id: existing.id, status: "REQUESTED", providerEnrollmentAvailable: false };
      if (existing.status === "WITHDRAWN") {
        if (await tx.configurationProfile.count({ where: { organisationId: session.organisationId, domain: CARD_SUBSCRIPTION_DOMAIN, status: { in: CARD_SUBSCRIPTION_OPEN_STATUSES }, config: { path: ["accountId"], equals: accountId } } })) throw Error("CARD_AUTOPAY_PROVIDER_CANCELLATION_REQUIRED");
        const snapshot = { originalId: existing.id, status: existing.status, originalCreatedAt: existing.createdAt.toISOString(), originalUpdatedAt: existing.updatedAt.toISOString(), terms: existing.config };
        const sourceHash = cardSourceHash(snapshot);
        await tx.configurationProfile.create({ data: { ...key, domain: CARD_REQUEST_HISTORY_DOMAIN, name: `${accountId}:${sourceHash}`, status: "RETAINED", config: { ...snapshot, sourceHash } } });
        const renewed = await tx.configurationProfile.update({ where: { id: existing.id }, data: { status: "REQUESTED", config: { ...preview, requestedAt: now.toISOString() } } });
        await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: preview.facilityId, action: "card_autopay.request_renewed", entityType: "Account", entityId: accountId, after: { requestId: renewed.id, previousSourceHash: sourceHash, fingerprint, providerEnrollmentAvailable: false } } });
        return { id: renewed.id, status: "REQUESTED", providerEnrollmentAvailable: false };
      }
      // A different request is not permission to overwrite previously recorded terms.
      throw new Error("CARD_AUTOPAY_REQUEST_EXISTS");
    }
    const record = await tx.configurationProfile.create({ data: { ...key, status: "REQUESTED", config: { ...preview, requestedAt: now.toISOString() } } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: preview.facilityId, action: "card_autopay.request_recorded", entityType: "Account", entityId: accountId, after: { requestId: record.id, fingerprint, termsVersion: preview.termsVersion, monthlyAmount: preview.monthlyAmount, schedule: preview.schedule, status: "REQUESTED", providerEnrollmentAvailable: false } } });
    return { id: record.id, status: "REQUESTED", providerEnrollmentAvailable: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

