import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requireLeasingCustomer } from "@/lib/leasing-service";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { compareHistoryEntries, customerNoteSchema, decodeHistoryCursor, encodeHistoryCursor, historyQuerySchema, noteCategories, type CustomerNoteInput, type HistoryEntry, type HistoryQuery } from "@/lib/customer-history-policy";
import { archivedHistoryText } from "@/lib/customer-history-message-policy";

type Client = Prisma.TransactionClient;
const PAGE_SIZE = 50;

/** A notebook belongs to a customer at one store, not every store sharing that customer. */
export async function customerNoteFacilities(scope: RequestScope, customerId: string, client: Client = db) {
  const customer = await requireLeasingCustomer(scope, customerId, client);
  const linked = await client.facility.findMany({
    where: { AND: [facilityWhere(scope), { OR: [
      { leads: { some: { customerId } } }, { reservations: { some: { customerId } } }, { tenancies: { some: { customerId } } },
    ] }] }, select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  if (linked.length) return { customer, facilities: linked };
  // Preserve the existing creator-only access rule for an as-yet unlinked customer.
  const links = await client.customer.findFirst({ where: { id: customerId, leads: { none: {} }, reservations: { none: {} }, tenancies: { none: {} } }, select: { id: true } });
  return { customer, facilities: links ? await client.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }) : [] };
}

export async function addCustomerNote(scope: RequestScope, customerId: string, input: CustomerNoteInput) {
  const data = customerNoteSchema.parse(input);
  return db.$transaction(async tx => {
    await requireLeasingCustomer(scope, customerId, tx);
    // Serialize retries/concurrent writers and keep the note + audit atomic.
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;
    const { facilities } = await customerNoteFacilities(scope, customerId, tx);
    if (!facilities.some(f => f.id === data.facilityId)) throw new Error("FACILITY_FORBIDDEN");
    const previous = await tx.customerNote.findUnique({ where: { customerId_requestKey: { customerId, requestKey: data.requestKey } } });
    if (previous) {
      if (previous.organisationId !== scope.organisationId || previous.authorId !== scope.userId || previous.facilityId !== data.facilityId || previous.category !== data.category || previous.body !== data.body) throw new Error("CONFLICT");
      return { id: previous.id, createdAt: previous.createdAt };
    }
    const author = await tx.user.findFirst({ where: { id: scope.userId, organisationId: scope.organisationId, active: true }, select: { name: true } });
    if (!author) throw new Error("UNAUTHENTICATED");
    const note = await tx.customerNote.create({ data: { ...data, customerId, organisationId: scope.organisationId, authorId: scope.userId, authorName: author.name } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: data.facilityId, actorId: scope.userId, entityType: "CustomerNote", entityId: note.id, action: "customer.note_added", after: { customerId, category: data.category } } });
    return { id: note.id, createdAt: note.createdAt };
  });
}

function pageBoundary(kind: HistoryEntry["kind"], dateKey: string, cursor: ReturnType<typeof decodeHistoryCursor>, snapshot: Date) {
  if (!cursor) return { [dateKey]: { lte: snapshot } };
  const date = new Date(cursor.at);
  const equal = kind < cursor.kind ? { [dateKey]: date } : kind === cursor.kind ? { [dateKey]: date, id: { lt: cursor.id } } : null;
  return { AND: [{ [dateKey]: { lte: snapshot } }, { OR: [{ [dateKey]: { lt: date } }, ...(equal ? [equal] : [])] }] };
}

export async function customerHistory(scope: RequestScope, customerId: string, input: HistoryQuery, access: { communications: RequestScope | null; collections: RequestScope | null; write: RequestScope | null }, selectedRecordId?: string) {
  // A secondary grant cannot widen the customer-page store scope.
  const intersect = (other: RequestScope | null): RequestScope | null => {
    if (!other || other.organisationId !== scope.organisationId || other.userId !== scope.userId) return null;
    if (scope.unrestrictedFacilities) return other;
    const facilityIds = scope.facilityIds.filter(id => other.unrestrictedFacilities || other.facilityIds.includes(id));
    return facilityIds.length ? { ...other, unrestrictedFacilities: false, facilityIds } : null;
  };
  access = { communications: intersect(access.communications), collections: intersect(access.collections), write: intersect(access.write) };
  const query = historyQuerySchema.parse(input);
  const cursor = decodeHistoryCursor(query.cursor);
  const snapshot = new Date(cursor?.snapshot ?? new Date().toISOString());
  const { customer, facilities } = await customerNoteFacilities(scope, customerId);
  const source = (kind: HistoryEntry["kind"]) => query.kind === "ALL" || query.kind === kind;
  const entry = (value: Partial<HistoryEntry> & Pick<HistoryEntry, "id" | "kind" | "at" | "title">): HistoryEntry => ({
    body: null, category: null, author: null, facility: null, channel: null, status: null, sentAt: null, deliveredAt: null, readAt: null, ...value,
  });
  const [notes, activities, messages] = await Promise.all([
    source("NOTE") ? db.customerNote.findMany({
      where: { organisationId: scope.organisationId, customerId, facility: facilityWhere(scope), ...(selectedRecordId ? { id:selectedRecordId } : {}), ...(query.category ? { category: query.category } : {}), ...(query.search ? { body: { contains: query.search, mode: "insensitive" } } : {}), ...pageBoundary("NOTE", "createdAt", cursor, snapshot) },
      include: { facility: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
    }) : [],
    source("COLLECTION") && !query.category && access.collections ? db.collectionActivity.findMany({
      where: { case: { account: { customerId, customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(access.collections) } } }, ...(selectedRecordId ? { id:selectedRecordId } : {}), ...(query.search ? { note: { contains: query.search, mode: "insensitive" } } : {}), ...pageBoundary("COLLECTION", "createdAt", cursor, snapshot) },
      include: { case: { select: { account: { select: { accountNumber: true, tenancy: { select: { facility: { select: { name: true } } } } } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
    }) : [],
    source("COMMUNICATION") && !query.category && access.communications ? db.communicationLog.findMany({
      where: { organisationId: scope.organisationId, customerId, ...(selectedRecordId ? { id:selectedRecordId } : {}), channel: { in: ["EMAIL", "SMS", "WHATSAPP"] },
        AND: [
          ...(access.communications.unrestrictedFacilities ? [] : [{ OR: [{ facilityId: { in: access.communications.facilityIds } }, { facilityId: null }] }]),
          ...(query.search ? [{ OR: [{ messageType: { contains: query.search, mode: "insensitive" as const } }, { channel: { contains: query.search, mode: "insensitive" as const } }] }] : []),
          pageBoundary("COMMUNICATION", "queuedAt", cursor, snapshot),
        ],
      },
      select: { id: true, queuedAt: true, messageType: true, channel: true, direction: true, status: true, sentAt: true, deliveredAt: true, readAt: true, metadata: true, facility: { select: { name: true } } },
      orderBy: [{ queuedAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
    }) : [],
  ]);
  const actors = activities.length ? await db.user.findMany({ where: { organisationId: scope.organisationId, id: { in: [...new Set(activities.map(a => a.actorId))] } }, select: { id: true, name: true } }) : [];
  const entries = [
    ...notes.map(n => entry({ id: n.id, kind: "NOTE", at: n.createdAt.toISOString(), title: noteCategories[n.category as keyof typeof noteCategories] ?? n.category, body: n.body, category: n.category, author: n.authorName, facility: n.facility.name })),
    ...activities.map(a => entry({ id: a.id, kind: "COLLECTION", at: a.createdAt.toISOString(), title: `Collections · ${a.action.replaceAll("-", " ")} · ${a.case.account.accountNumber}`, body: a.note, author: actors.find(u => u.id === a.actorId)?.name ?? "Former staff member", facility: a.case.account.tenancy?.facility.name ?? null })),
    ...messages.map(m => entry({ id: m.id, kind: "COMMUNICATION", at: m.queuedAt.toISOString(), title: `${m.channel} · ${(m.messageType ?? "Recorded communication").replaceAll("_", " ")}`, channel: m.channel, status: m.status, body: (/VERIFICATION|OTP|PASSWORD|LOGIN|AUTHENTICATION/i.test(m.messageType ?? "") ? null : archivedHistoryText(m.metadata)) ?? (m.direction === "INBOUND" ? "Inbound communication record" : "Outbound communication record"), facility: m.facility?.name ?? "Store not recorded", sentAt: m.sentAt?.toISOString() ?? null, deliveredAt: m.deliveredAt?.toISOString() ?? null, readAt: m.readAt?.toISOString() ?? null })),
  ].sort(compareHistoryEntries);
  const data = entries.slice(0, PAGE_SIZE), last = data.at(-1);
  let writable: Array<{ id: string; name: string }> = [];
  if (access.write) {
    try { writable = (await customerNoteFacilities(access.write, customerId)).facilities; }
    catch (error) { if (!(error instanceof Error && error.message.includes("FORBIDDEN"))) throw error; }
  }
  return {
    entries: data,
    nextCursor: entries.length > PAGE_SIZE && last ? encodeHistoryCursor({ at: last.at, kind: last.kind, id: last.id, snapshot: snapshot.toISOString() }) : null,
    facilities, writableFacilities: writable,
    visibility: { communications: !!access.communications, collections: !!access.collections },
    legacyNotes: customer.notes,
  };
}
