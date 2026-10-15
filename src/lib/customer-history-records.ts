import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import type { HistoryEntry, HistoryQuery } from "@/lib/customer-history-policy";
const milestoneTitles: Record<string, string> = { "tenancy.lease_sent_for_signature": "Move-in started: agreement sent", "tenancy.lease_signed": "Tenancy agreement signed", "tenancy.blendsign_completed": "Tenancy agreement signing completed", "tenancy.key_handover_confirmed": "Keys handed over", "tenancy.moved_out": "Move-out recorded" };

/** Project only staff-safe source fields. Never return document content, signing links or raw audit JSON. */
export async function customerHistoryRecords(scope: RequestScope, customerId: string, query: HistoryQuery, financial: RequestScope | null,
  boundary: (kind: HistoryEntry["kind"], dateKey: string) => object, selectedRecordId?: string): Promise<HistoryEntry[]> {
  const source = (kind: HistoryEntry["kind"]) => !query.category && !query.channel && !query.status && (query.kind === "ALL" || query.kind === kind);
  const selected = selectedRecordId ? { id: selectedRecordId } : {};
  const facility = { select: { name: true } } as const;
  const tenancy = { customerId, customer: { organisationId: scope.organisationId }, facility: facilityWhere(scope) };
  const search = query.search ? { contains: query.search, mode: "insensitive" as const } : undefined;
  const author = (value: { name: string; organisationId: string } | null) => value?.organisationId === scope.organisationId ? value.name : null;
  const linked = source("MILESTONE") ? await db.tenancy.findMany({ where: tenancy, select: { id: true, facilityId: true }, take: 1001 }) : [];
  if (linked.length > 1000) throw new Error("HISTORY_SOURCE_LIMIT");
  const [bookings, tenancies, documents, agreements, ledger, appointments, milestones] = await Promise.all([
    source("BOOKING") ? db.reservation.findMany({ where: { customerId, customer: { organisationId: scope.organisationId }, facility: facilityWhere(scope), ...selected,
      ...(search ? { OR: [{ publicReference: search }, { source: search }, { unit: { number: search } }] } : {}), ...boundary("BOOKING", "createdAt") },
      select: { id: true, facilityId: true, createdAt: true, publicReference: true, status: true, journey: true, intendedMoveIn: true, facility, unit: { select: { number: true, facilityId: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 }) : [],
    source("TENANCY") ? db.tenancy.findMany({ where: { ...tenancy, ...selected, ...(search ? { account: { accountNumber: search } } : {}), ...boundary("TENANCY", "createdAt") },
      select: { id: true, createdAt: true, status: true, startDate: true, endDate: true, facility, account: { select: { accountNumber: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 }) : [],
    source("DOCUMENT") ? db.document.findMany({ where: { tenancy, ...selected, ...(search ? { type: search } : {}), ...boundary("DOCUMENT", "createdAt") },
      select: { id: true, createdAt: true, type: true, status: true, signedAt: true, tenancy: { select: { facility } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 }) : [],
    source("AGREEMENT") ? db.publicReservationLease.findMany({ where: { reservation: { customerId, customer: { organisationId: scope.organisationId }, facility: facilityWhere(scope) }, signedAt: { not: null }, ...selected,
      ...(search ? { reservation: { customerId, customer: { organisationId: scope.organisationId }, facility: facilityWhere(scope), publicReference: search } } : {}), ...boundary("AGREEMENT", "signedAt") },
      select: { id: true, signedAt: true, status: true, reservation: { select: { publicReference: true, facility } } }, orderBy: [{ signedAt: "desc" }, { id: "desc" }], take: 51 }) : [],
    source("ACCOUNT") && financial ? db.ledgerEntry.findMany({ where: { account: { customerId, customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(financial) } }, ...selected,
      ...(search ? { description: search } : {}), ...boundary("ACCOUNT", "createdAt") }, select: { id: true, createdAt: true, effectiveAt: true, type: true, amount: true, description: true, reversalOfId: true, createdBy: { select: { name: true, organisationId: true } }, account: { select: { accountNumber: true, tenancy: { select: { facility } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 }) : [],
    source("APPOINTMENT") ? db.auditEvent.findMany({ where: { organisationId: scope.organisationId, facility: facilityWhere(scope), entityType: "Task", action: { in: ["staff_followup.created", "staff_followup.handover", "staff_followup.acknowledge", "staff_followup.complete", "staff_followup.cancel"] },
      after: { path: ["customerId"], equals: customerId }, ...selected, ...(search ? { OR: [{ after: { path: ["title"], string_contains: query.search, mode: "insensitive" as const } }, { after: { path: ["description"], string_contains: query.search, mode: "insensitive" as const } }] } : {}), ...boundary("APPOINTMENT", "occurredAt") },
      select: { id: true, occurredAt: true, action: true, after: true, actor: { select: { name: true, organisationId: true } }, facility }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 51 }) : [],
    linked.length ? db.auditEvent.findMany({ where: { organisationId: scope.organisationId, entityType: "Tenancy", OR: linked.map(row => ({ entityId: row.id, facilityId: row.facilityId })),
      action: { in: Object.entries(milestoneTitles).filter(([action, title]) => !query.search || `${action} ${title}`.toLowerCase().includes(query.search.toLowerCase())).map(([action]) => action) },
      ...selected, ...boundary("MILESTONE", "occurredAt") },
      select: { id: true, occurredAt: true, action: true, actor: { select: { name: true, organisationId: true } }, facility }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 51 }) : [],
  ]);
  const entry = (value: Partial<HistoryEntry> & Pick<HistoryEntry, "id" | "kind" | "at" | "title">): HistoryEntry => ({ body: null, category: null, author: null, facility: null, channel: null, status: null, sentAt: null, deliveredAt: null, readAt: null, ...value });
  const day = (value: Date) => value.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" });
  return [
    ...bookings.map(row => entry({ id: row.id, kind: "BOOKING", at: row.createdAt.toISOString(), title: row.unit.facilityId === row.facilityId ? `Booking recorded · Unit ${row.unit.number}` : "Booking recorded · Unit source needs review", body: `${row.publicReference ?? "Staff booking"} · ${row.journey.toLowerCase()}${row.intendedMoveIn ? ` · Intended arrival ${day(row.intendedMoveIn)}` : " · Arrival date not recorded"}. Status shown is current.`, status: row.status, facility: row.facility.name })),
    ...tenancies.map(row => entry({ id: row.id, kind: "TENANCY", at: row.createdAt.toISOString(), title: `Tenancy recorded · ${row.account.accountNumber}`, body: `Start ${day(row.startDate)}${row.endDate ? ` · End ${day(row.endDate)}` : ""}. Status shown is current; this event does not confirm keys or access.`, status: row.status, facility: row.facility.name })),
    ...documents.map(row => entry({ id: row.id, kind: "DOCUMENT", at: row.createdAt.toISOString(), title: `Document recorded · ${row.type.replaceAll("_", " ")}`, body: `${row.signedAt ? `Signed ${day(row.signedAt)}. ` : ""}Status shown is current. Original documents remain in the customer documents area.`, status: row.status, facility: row.tenancy.facility.name })),
    ...agreements.filter(row => row.signedAt).map(row => entry({ id: row.id, kind: "AGREEMENT", at: row.signedAt!.toISOString(), title: "Booking agreement signed", body: `${row.reservation.publicReference ?? "Booking"}. Signature is separate from payment verification and move-in readiness.`, status: row.status, facility: row.reservation.facility.name })),
    ...ledger.map(row => entry({ id: row.id, kind: "ACCOUNT", at: row.createdAt.toISOString(), title: `Account entry · ${row.account.accountNumber} · ${row.type}`, body: `${row.description} · Recorded amount ZAR ${row.amount.toFixed(2)} · Effective ${day(row.effectiveAt)}${row.reversalOfId ? " · Reversal entry" : ""}. This is a ledger record, not independent bank settlement proof.`, author: author(row.createdBy), facility: row.account.tenancy?.facility.name ?? null })),
    ...milestones.map(row => entry({ id: row.id, kind: "MILESTONE", at: row.occurredAt.toISOString(), title: milestoneTitles[row.action], body: "Retained staff workflow event. Signing, payment verification, key handover and active access are separate stages.", author: author(row.actor), facility: row.facility?.name ?? null })),
    ...appointments.map(row => {
      const data = row.after && typeof row.after === "object" && !Array.isArray(row.after) ? row.after : {};
      const title = "title" in data && typeof data.title === "string" ? data.title.slice(0, 200) : "Customer follow-up";
      const description = "description" in data && typeof data.description === "string" ? data.description.slice(0, 5000) : "";
      return entry({ id: row.id, kind: "APPOINTMENT", at: row.occurredAt.toISOString(), title: `${row.action.replace("staff_followup.", "Follow-up ")} · ${title}`, body: description || null, author: author(row.actor), facility: row.facility?.name ?? null });
    }),
  ];
}
