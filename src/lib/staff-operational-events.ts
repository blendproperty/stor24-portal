import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { decodeEventCursor, encodeEventCursor, eventAcknowledgeSchema, eventQuerySchema, type EventKind } from "@/lib/staff-attention-policy";

type Client = Prisma.TransactionClient;
const person = { firstName: true, lastName: true, companyName: true } as const;
const sourceSelect = { id: true, facilityId: true, customerId: true, unit: { select: { number: true } }, facility: { select: { name: true } }, customer: { select: person } } as const;
export type StaffOperationalEvent = { id: string; kind: EventKind; sourceKey: string; sourceHash: string; at: string; customer: string; customerId: string; facilityId: string; facility: string; unit: string | null; href: string; acknowledgedAt: string | null };
const customerName = (c: { companyName: string | null; firstName: string | null; lastName: string | null }) => c.companyName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer";

async function sourceEvents(scope: RequestScope, input: { cursor?: string; from?: Date; to?: Date }, tx: Client = db, selectedKey?: string, limit = 51) {
  const cursor = decodeEventCursor(input.cursor), snapshot = cursor?.snapshot ?? new Date().toISOString();
  const selected = selectedKey?.split(":");
  const boundary = (kind: EventKind, field: string) => ({ AND: [
    { [field]: { lte: new Date(snapshot), ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) } },
    ...(selected ? [{ id: selected[1] }] : []),
    ...(cursor ? [{ OR: [{ [field]: { lt: new Date(cursor.at) } }, ...(kind < cursor.kind ? [{ [field]: new Date(cursor.at) }] : kind === cursor.kind ? [{ [field]: new Date(cursor.at), id: { lt: cursor.id } }] : [])] }] : []),
  ] });
  const [bookings, leases, started, handed] = await Promise.all([
    !selected || selected[0] === "BOOKING" ? tx.reservation.findMany({ where: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId }, ...boundary("BOOKING", "createdAt") }, select: { ...sourceSelect, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit }) : [],
    !selected || selected[0] === "SIGNED" ? tx.publicReservationLease.findMany({ where: { reservation: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } }, status: "SIGNED", signedPdfSha256: { not: null }, signedAt: { not: null }, ...boundary("SIGNED", "signedAt") }, select: { id: true, signedAt: true, signedPdfSha256: true, reservation: { select: sourceSelect } }, orderBy: [{ signedAt: "desc" }, { id: "desc" }], take: limit }) : [],
    !selected || selected[0] === "MOVE_IN_STARTED" ? tx.auditEvent.findMany({ where: { organisationId: scope.organisationId, facility: facilityWhere(scope), entityType: "Tenancy", action: "tenancy.lease_sent_for_signature", ...boundary("MOVE_IN_STARTED", "occurredAt") }, select: { id: true, action: true, entityId: true, occurredAt: true, facilityId: true }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit }) : [],
    !selected || selected[0] === "HANDED_OVER" ? tx.auditEvent.findMany({ where: { organisationId: scope.organisationId, facility: facilityWhere(scope), entityType: "Tenancy", action: "tenancy.key_handover_confirmed", ...boundary("HANDED_OVER", "occurredAt") }, select: { id: true, action: true, entityId: true, occurredAt: true, facilityId: true }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit }) : [],
  ]);
  const audits = [...started, ...handed];
  const tenancies = audits.length ? await tx.tenancy.findMany({ where: { id: { in: audits.map(a => a.entityId) }, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } }, select: { id: true, facilityId: true, customerId: true, facility: { select: { name: true } }, customer: { select: person }, occupancies: { select: { unit: { select: { number: true } } }, orderBy: { createdAt: "asc" }, take: 1 } } }) : [];
  function event(kind: EventKind, id: string, at: Date, source: { id: string; facilityId: string; facility: { name: string }; customerId: string; customer: { companyName: string | null; firstName: string | null; lastName: string | null }; unit?: { number: string } }, proof = ""): StaffOperationalEvent {
    const sourceKey = `${kind}:${id}`;
    return { id, kind, sourceKey, sourceHash: createHash("sha256").update(JSON.stringify([sourceKey, at.toISOString(), source.id, source.facilityId, source.customerId, source.unit?.number, proof])).digest("hex"), at: at.toISOString(), customer: customerName(source.customer), customerId: source.customerId, facilityId: source.facilityId, facility: source.facility.name, unit: source.unit?.number ?? null, href: `/tenants?customer=${encodeURIComponent(source.customerId)}`, acknowledgedAt: null };
  }
  const events = [
    ...bookings.map(r => event("BOOKING", r.id, r.createdAt, r)),
    ...leases.flatMap(l => l.signedAt ? [event("SIGNED", l.id, l.signedAt, l.reservation, l.signedPdfSha256 ?? "")] : []),
    ...audits.flatMap(a => { const source = tenancies.find(t => t.id === a.entityId && t.facilityId === a.facilityId); return source ? [event(a.action === "tenancy.key_handover_confirmed" ? "HANDED_OVER" : "MOVE_IN_STARTED", a.id, a.occurredAt, { ...source, unit: source.occupancies[0]?.unit })] : []; }),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.kind.localeCompare(a.kind) || b.id.localeCompare(a.id));
  // Page raw source positions even if a historical audit's deleted tenancy is unavailable.
  // Otherwise a full page of orphaned audit records could hide older valid events.
  const candidates = [
    ...bookings.map(r => ({ id: r.id, kind: "BOOKING" as const, at: r.createdAt.toISOString() })),
    ...leases.flatMap(l => l.signedAt ? [{ id: l.id, kind: "SIGNED" as const, at: l.signedAt.toISOString() }] : []),
    ...audits.map(a => ({ id: a.id, kind: (a.action === "tenancy.key_handover_confirmed" ? "HANDED_OVER" : "MOVE_IN_STARTED") as EventKind, at: a.occurredAt.toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.kind.localeCompare(a.kind) || b.id.localeCompare(a.id));
  return { events, candidates, snapshot, sourceExceeded: [bookings, leases, started, handed].some(rows => rows.length >= limit) };
}

/** Exact scoped source read for reviewed staff notifications; never acknowledges an event. */
export async function staffOperationalEmailSource(scope: RequestScope, sourceKey: string, tx: Client = db) {
  eventAcknowledgeSchema.pick({ sourceKey: true }).parse({ sourceKey });
  return (await sourceEvents(scope, {}, tx, sourceKey)).events.find(event => event.sourceKey === sourceKey) ?? null;
}

/** Pages raw source positions so orphaned historical audits cannot hide later pages. */
export async function staffOperationalEmailPage(scope: RequestScope, input: { from: Date; to: Date; cursor?: string }, tx: Client = db) {
  const { events, candidates, snapshot } = await sourceEvents(scope, input, tx, undefined, 11);
  const positions = candidates.slice(0, 10), keys = new Set(positions.map(row => `${row.kind}:${row.id}`)), last = positions.at(-1);
  return { events: events.filter(event => keys.has(event.sourceKey)), nextCursor: candidates.length > 10 && last ? encodeEventCursor({ ...last, snapshot }) : null };
}

export async function staffOperationalInbox(scope: RequestScope, input: unknown) {
  const query = eventQuerySchema.parse(input), { events, candidates, snapshot } = await sourceEvents(scope, query);
  const positions = candidates.slice(0, 50), keys = new Set(positions.map(c => `${c.kind}:${c.id}`));
  const page = events.filter(e => keys.has(e.sourceKey));
  const saved = page.length ? await db.staffOperationalAcknowledgement.findMany({ where: { organisationId: scope.organisationId, userId: scope.userId, facility: facilityWhere(scope), sourceKey: { in: page.map(e => e.sourceKey) } }, select: { sourceKey: true, sourceHash: true, acknowledgedAt: true } }) : [];
  const last = positions.at(-1);
  return { events: page.map(e => ({ ...e, acknowledgedAt: saved.find(s => s.sourceKey === e.sourceKey && s.sourceHash === e.sourceHash)?.acknowledgedAt.toISOString() ?? null })), nextCursor: candidates.length > 50 && last ? encodeEventCursor({ at: last.at, kind: last.kind, id: last.id, snapshot }) : null };
}

export async function staffOperationalUnreadCount(scope: RequestScope) {
  const { events, candidates, sourceExceeded } = await sourceEvents(scope, {}, db, undefined, 1001);
  if (sourceExceeded || candidates.length > 1000) throw new Error("STAFF_EVENT_SOURCE_LIMIT");
  const saved = events.length ? await db.staffOperationalAcknowledgement.findMany({ where: { organisationId: scope.organisationId, userId: scope.userId, facility: facilityWhere(scope), sourceKey: { in: events.map(e => e.sourceKey) } }, select: { sourceKey: true, sourceHash: true } }) : [];
  const read = new Map(saved.map(s => [s.sourceKey, s.sourceHash]));
  return events.filter(e => read.get(e.sourceKey) !== e.sourceHash).length;
}

export async function acknowledgeOperationalEvent(scope: RequestScope, input: unknown) {
  const data = eventAcknowledgeSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([scope.organisationId, scope.userId, data.sourceKey])}, 0))`;
    const current = (await sourceEvents(scope, {}, tx, data.sourceKey)).events.find(e => e.sourceKey === data.sourceKey);
    if (!current) throw new Error("FORBIDDEN");
    if (current.sourceHash !== data.sourceHash) throw new Error("CONFLICT");
    const where = { organisationId_userId_sourceKey: { organisationId: scope.organisationId, userId: scope.userId, sourceKey: data.sourceKey } };
    const before = await tx.staffOperationalAcknowledgement.findUnique({ where });
    if (before?.sourceHash === current.sourceHash) return before;
    const saved = await tx.staffOperationalAcknowledgement.upsert({ where, create: { organisationId: scope.organisationId, facilityId: current.facilityId, userId: scope.userId, sourceKey: current.sourceKey, sourceHash: current.sourceHash }, update: { sourceHash: current.sourceHash, acknowledgedAt: new Date() } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: current.facilityId, actorId: scope.userId, action: "staff_event.acknowledged", entityType: "StaffOperationalAcknowledgement", entityId: saved.id, after: { sourceKey: current.sourceKey, sourceHash: current.sourceHash } } });
    return saved;
  });
}
