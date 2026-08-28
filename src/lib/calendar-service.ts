import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export type CalendarItem = { id: string; at: Date; kind: "TASK" | "LEAD" | "VIEWING" | "MOVE_OUT"; title: string; detail: string; href: string };

function dateKeys(startKey: string, count: number) {
  const start = new Date(`${startKey}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}

export async function getOperationsCalendar(scope: RequestScope, now = new Date()) {
  const keys = dateKeys(southAfricaDateKey(now), 7);
  const rangeStart = new Date(`${keys[0]}T00:00:00+02:00`);
  const rangeEnd = new Date(`${dateKeys(keys[0], 8)[7]}T00:00:00+02:00`);
  const directFacilityScope = scope.unrestrictedFacilities ? {} : { OR: [{ facilityId: null }, { facilityId: { in: scope.facilityIds } }] };

  const [tasks, leads, viewings, moveOuts] = await Promise.all([
    db.task.findMany({ where: { organisationId: scope.organisationId, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueAt: { gte: rangeStart, lt: rangeEnd }, ...directFacilityScope }, include: { facility: { select: { name: true } } }, orderBy: { dueAt: "asc" } }),
    db.lead.findMany({ where: { facility: facilityWhere(scope), stage: { notIn: ["WON", "LOST"] }, nextActionAt: { gte: rangeStart, lt: rangeEnd } }, include: { facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } } }, orderBy: { nextActionAt: "asc" } }),
    db.reservation.findMany({ where: { facility: facilityWhere(scope), status: "ACTIVE", viewingAt: { gte: rangeStart, lt: rangeEnd } }, include: { facility: { select: { name: true } }, unit: { select: { number: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } } }, orderBy: { viewingAt: "asc" } }),
    db.tenancy.findMany({ where: { facility: facilityWhere(scope), status: "NOTICE_GIVEN", endDate: { gte: rangeStart, lt: rangeEnd } }, include: { facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } }, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { select: { number: true } } }, take: 1 } }, orderBy: { endDate: "asc" } }),
  ]);

  const customerName = (customer: { firstName: string | null; lastName: string | null; companyName: string | null }) => customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer";
  const items: CalendarItem[] = [
    ...tasks.flatMap((item) => item.dueAt ? [{ id: item.id, at: item.dueAt, kind: "TASK" as const, title: item.title, detail: item.facility?.name ?? "Portfolio", href: "/operations" }] : []),
    ...leads.flatMap((item) => item.nextActionAt ? [{ id: item.id, at: item.nextActionAt, kind: "LEAD" as const, title: `Follow up · ${customerName(item.customer ?? { firstName: null, lastName: null, companyName: null })}`, detail: item.facility.name, href: "/leads" }] : []),
    ...viewings.flatMap((item) => item.viewingAt ? [{ id: item.id, at: item.viewingAt, kind: "VIEWING" as const, title: `Viewing · Unit ${item.unit.number}`, detail: `${customerName(item.customer)} · ${item.facility.name}`, href: "/reservations" }] : []),
    ...moveOuts.flatMap((item) => item.endDate ? [{ id: item.id, at: item.endDate, kind: "MOVE_OUT" as const, title: `Move-out · Unit ${item.occupancies[0]?.unit.number ?? "—"}`, detail: `${customerName(item.customer)} · ${item.facility.name}`, href: "/operations/accounts" }] : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return keys.map((key) => ({ key, items: items.filter((item) => southAfricaDateKey(item.at) === key) }));
}
