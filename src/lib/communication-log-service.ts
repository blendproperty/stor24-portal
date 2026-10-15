import { db } from "@/lib/db";
import { leasingCustomerWhere } from "@/lib/leasing-service";
import type { RequestScope } from "@/lib/scope";
import { facilityWhere, requireFacility } from "@/lib/scope";
import { requireLeasingCustomer } from "@/lib/leasing-service";
import type { Prisma } from "@/generated/prisma/client";
import { communicationFiltersSchema, communicationDateRange, type CommunicationFilters, type CommunicationLogRead } from "./communication-log-query";
import { communicationCursor, readCommunicationCursor } from "./communication-log-cursor";
import { canRetryWhatsAppDelivery } from "./whatsapp";

function communicationWhere(scope: RequestScope): Prisma.CommunicationLogWhereInput {
  return { organisationId: scope.organisationId, channel: { in: ["EMAIL", "SMS", "WHATSAPP"] }, AND: [
    { OR: [{ customerId: null }, { customer: { organisationId: scope.organisationId } }] },
    { OR: [{ facilityId: null }, { facility: { organisationId: scope.organisationId } }] },
    ...(scope.unrestrictedFacilities ? [] : [{ OR: [
      { facilityId: { in: scope.facilityIds } },
      { facilityId: null, customer: leasingCustomerWhere(scope, scope.facilityIds) },
    ] }]),
  ] };
}

/** Unassigned historical messages still require a visible customer relationship. */
export function listCommunicationLogs(scope: RequestScope) {
  return db.communicationLog.findMany({
    where: communicationWhere(scope),
    include: { customer: { select: { firstName: true, lastName: true, companyName: true } }, facility: { select: { name: true } } },
    orderBy: [{ queuedAt: "desc" }, { id: "desc" }], take: 100,
  });
}

/** Read-only global delivery lookup. Provider payloads, recipient hashes and bodies never leave this service. */
export async function communicationLogPage(scope: RequestScope, input: CommunicationFilters, cursorValue = ""): Promise<CommunicationLogRead> {
  const filters = communicationFiltersSchema.parse(input);
  if (filters.facilityId) await requireFacility(scope, filters.facilityId);
  if (filters.customerId) await requireLeasingCustomer(scope, filters.customerId);
  const cursor = readCommunicationCursor(cursorValue, filters, scope);
  const snapshot = new Date(cursor?.snapshot ?? new Date().toISOString());
  const customerSearch: Prisma.CustomerWhereInput[] = filters.search ? filters.search.split(/\s+/).map(term => ({ OR: [
    { firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } },
    { companyName: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } },
    { phone: { contains: term } }, { id: { endsWith: term.toLowerCase() } },
  ] })) : [];
  const where: Prisma.CommunicationLogWhereInput = { AND: [communicationWhere(scope),
    { queuedAt: { ...communicationDateRange(filters), lte: snapshot } },
    ...(filters.channel ? [{ channel: filters.channel }] : []), ...(filters.status ? [{ status: filters.status }] : []),
    ...(filters.facilityId ? [{ facilityId: filters.facilityId }] : []), ...(filters.customerId ? [{ customerId: filters.customerId }] : []),
    ...(customerSearch.length ? [{ customer: { AND: [{ organisationId: scope.organisationId }, ...customerSearch] } }] : []),
  ] };
  if (cursor && !await db.communicationLog.findFirst({ where: { AND: [where, { id: cursor.id, queuedAt: new Date(cursor.at) }] }, select: { id: true } })) throw Error("NOT_FOUND");
  const [records, facilities] = await Promise.all([
    db.communicationLog.findMany({ where: { AND: [where, ...(cursor ? [{ OR: [{ queuedAt: { lt: new Date(cursor.at) } }, { queuedAt: new Date(cursor.at), id: { lt: cursor.id } }] }] : [])] },
      select: { id: true, customerId: true, customer: { select: { firstName: true, lastName: true, companyName: true } }, facility: { select: { name: true } },
        channel: true, direction: true, messageType: true, status: true, queuedAt: true, sentAt: true, deliveredAt: true, readAt: true,
        failedAt: true, failureCode: true, providerRef: true, metadata: true }, orderBy: [{ queuedAt: "desc" }, { id: "desc" }], take: 26 }),
    db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const page = records.slice(0, 25), ids = [...new Set(page.flatMap(row => row.customerId ? [row.customerId] : []))];
  const created = scope.unrestrictedFacilities || !ids.length ? [] : await db.auditEvent.findMany({ where: { organisationId: scope.organisationId, actorId: scope.userId, entityType: "Customer", action: "customer.created", entityId: { in: ids } }, select: { entityId: true } });
  const visible = ids.length ? await db.customer.findMany({ where: { id: { in: ids }, OR: [leasingCustomerWhere(scope, scope.facilityIds),
    ...(created.length ? [{ organisationId: scope.organisationId, id: { in: created.map(row => row.entityId) }, leads: { none: {} }, reservations: { none: {} }, tenancies: { none: {} } }] : [])] }, select: { id: true } }) : [];
  const visibleIds = new Set(visible.map(row => row.id));
  return { facilities, filters, snapshotAt: snapshot.toISOString(), nextCursor: records.length > 25 ? communicationCursor(page.at(-1)!, snapshot, filters, scope) : null,
    rows: page.map(row => ({ id: row.id, customerId: row.customerId, customerName: row.customer?.companyName || [row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(" ") || "Customer not recorded",
      canOpenCustomer: !!row.customerId && visibleIds.has(row.customerId), facilityName: row.facility?.name ?? "Store not recorded",
      channel: row.channel as "EMAIL" | "SMS" | "WHATSAPP", direction: row.direction === "INBOUND" ? "INBOUND" : row.direction === "OUTBOUND" ? "OUTBOUND" : "UNKNOWN", messageType: row.messageType, status: row.status,
      queuedAt: row.queuedAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null, readAt: row.readAt?.toISOString() ?? null,
      failureCode: row.failureCode ? (/^[A-Za-z0-9_-]{1,100}$/.test(row.failureCode) ? row.failureCode : "REVIEW_REQUIRED") : null,
      canRetryWhatsApp: row.channel === "WHATSAPP" && row.direction === "OUTBOUND" && canRetryWhatsAppDelivery(row) })),
  };
}
