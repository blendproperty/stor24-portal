import { db } from "@/lib/db";
import { facilityWhere, requireFacility, type RequestScope } from "@/lib/scope";
import { staffPaymentReviewReason } from "@/lib/staff-payment-review-policy";
import { isTestPayment } from "@/lib/payments/payment-evidence";

/** Read-only source evidence. Does not poll providers, acknowledge away exceptions or post receipts. */
export async function staffPaymentReviewQueue(scope: RequestScope, facilityId?: string, cursor?: string) {
  if (facilityId) await requireFacility(scope, facilityId);
  const facility = { ...facilityWhere(scope), ...(facilityId ? { id: facilityId } : {}) };
  const reservations = await db.reservation.findMany({ where: { facility, customer: { organisationId: scope.organisationId } }, select: { id: true, customerId: true, facilityId: true, facility: { select: { name: true } } }, take: 2001 });
  if (reservations.length > 2000) throw new Error("PAYMENT_REVIEW_SOURCE_LIMIT");
  const scopedFacilities = facilityId ? [facilityId] : scope.facilityIds;
  const where = { status: { in: ["PENDING", "SUCCEEDED"] as ("PENDING" | "SUCCEEDED")[] }, account: { customer: { organisationId: scope.organisationId }, OR: [{ tenancy: { facility } }, { accountNumber: { in: reservations.map(r => `ST24-T-${r.id}`) } }] }, AND: [
    { OR: [{ providerOrganisationId: null }, { providerOrganisationId: scope.organisationId }] },
    ...(scope.unrestrictedFacilities && !facilityId ? [] : [{ OR: [{ providerFacilityId: null }, { providerFacilityId: { in: scopedFacilities } }] }]),
  ] };
  if (cursor && !await db.payment.count({ where: { ...where, id: cursor } })) throw new Error("CONFLICT");
  const source = await db.payment.findMany({ where, include: { account: { select: { id: true, customerId: true, accountNumber: true, customer: { select: { firstName: true, lastName: true, companyName: true } }, tenancy: { select: { facilityId: true, customerId: true, facility: { select: { name: true } } } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: 101 });
  const payments = source.slice(0, 100);
  const entries = payments.length ? await db.ledgerEntry.findMany({ where: { accountId: { in: [...new Set(payments.map(p => p.accountId))] }, type: "PAYMENT", OR: payments.flatMap(p => [{ metadata: { path: ["paymentId"], equals: p.id } }, { externalRef: p.idempotencyKey }]) }, select: { id: true, accountId: true, type: true, amount: true, externalRef: true, metadata: true, createdById: true, reversalOfId: true }, take: 1001 }) : [];
  if (entries.length > 1000) throw new Error("PAYMENT_REVIEW_SOURCE_LIMIT");
  const reversals = entries.length ? await db.ledgerEntry.findMany({ where: { accountId: { in: [...new Set(payments.map(p => p.accountId))] }, reversalOfId: { in: entries.map(e => e.id) } }, select: { id: true, accountId: true, type: true, amount: true, externalRef: true, metadata: true, createdById: true, reversalOfId: true }, take: 1001 }) : [];
  if (reversals.length > 1000) throw new Error("PAYMENT_REVIEW_SOURCE_LIMIT");
  const rows = payments.flatMap(payment => {
    if (isTestPayment(payment)) return [];
    const booking = reservations.find(r => `ST24-T-${r.id}` === payment.account.accountNumber && r.customerId === payment.account.customerId);
    if (payment.account.accountNumber.startsWith("ST24-T-") && !booking) return [];
    const tenancy = payment.account.tenancy?.customerId === payment.account.customerId ? payment.account.tenancy : null;
    const sourceFacilityId = booking?.facilityId ?? tenancy?.facilityId;
    if (!sourceFacilityId) return [];
    const reason = payment.providerFacilityId && payment.providerFacilityId !== sourceFacilityId ? "SOURCE_REVIEW" as const : staffPaymentReviewReason({ ...payment, amount: payment.amount.toString() }, [...entries, ...reversals].filter(e => e.accountId === payment.accountId).map(e => ({ ...e, amount: e.amount.toString() })));
    if (!reason) return [];
    const c = payment.account.customer;
    return [{ id: payment.id, accountId: payment.accountId, customerId: payment.account.customerId, customer: c.companyName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer", facilityId: sourceFacilityId, facility: booking?.facility.name ?? tenancy?.facility.name ?? "Store", reason, amount: payment.amount.toString(), currency: payment.currency, createdAt: payment.createdAt.toISOString(), provider: payment.provider ?? "Staff receipt", href: payment.provider === "NETCASH" ? `/billing/netcash?facilityId=${encodeURIComponent(sourceFacilityId)}` : `/operations/accounts?accountId=${encodeURIComponent(payment.accountId)}` }];
  });
  return { rows, scanned: payments.length, nextCursor: source.length > 100 ? payments[99].id : null };
}

export async function staffPaymentReviewCount(scope: RequestScope) {
  let cursor: string | undefined, count = 0;
  for (let page = 0; page < 20; page++) {
    const result = await staffPaymentReviewQueue(scope, undefined, cursor);
    count += result.rows.length;
    if (!result.nextCursor) return count;
    cursor = result.nextCursor;
  }
  throw new Error("PAYMENT_REVIEW_SOURCE_LIMIT");
}
