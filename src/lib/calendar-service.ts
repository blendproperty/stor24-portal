import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export type CalendarItem = { id: string; at: Date; kind: "TASK" | "LEAD" | "VIEWING" | "MOVE_OUT" | "MOVE_IN"; title: string; detail: string; href: string };

function dateKeys(startKey: string, count: number) {
  const start = new Date(`${startKey}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}

export async function getOperationsCalendar(scope: RequestScope, now = new Date()) {
  const keys = dateKeys(southAfricaDateKey(now), 7);
  const rangeStart = new Date(`${keys[0]}T00:00:00+02:00`);
  const rangeEnd = new Date(`${dateKeys(keys[0], 8)[7]}T00:00:00+02:00`);
  const directFacilityScope = scope.unrestrictedFacilities ? { OR: [{ facilityId: null }, { facility: facilityWhere(scope) }] } : { facility: facilityWhere(scope) };

  const [tasks, leads, viewings, moveOuts, arrivals] = await Promise.all([
    db.task.findMany({ omit: { operationalChecklist: true, operationalForm: true }, where: { organisationId: scope.organisationId, status: { notIn: ["COMPLETED", "CANCELLED"] }, AND: [directFacilityScope, { OR: [{ startAt: { gte: rangeStart, lt: rangeEnd } }, { startAt: null, dueAt: { gte: rangeStart, lt: rangeEnd } }] }] }, include: { facility: { select: { name: true } } }, orderBy: { dueAt: "asc" } }),
    db.lead.findMany({ where: { facility: facilityWhere(scope), stage: { notIn: ["WON", "LOST"] }, nextActionAt: { gte: rangeStart, lt: rangeEnd } }, include: { facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } } }, orderBy: { nextActionAt: "asc" } }),
    db.reservation.findMany({ where: { facility: facilityWhere(scope), status: "ACTIVE", viewingAt: { gte: rangeStart, lt: rangeEnd } }, include: { facility: { select: { name: true } }, unit: { select: { number: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } } }, orderBy: { viewingAt: "asc" } }),
    db.tenancy.findMany({ where: { facility: facilityWhere(scope), status: "NOTICE_GIVEN", endDate: { gte: rangeStart, lt: rangeEnd } }, include: { facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } }, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { select: { number: true } } }, take: 1 } }, orderBy: { endDate: "asc" } }),
    db.reservation.findMany({ where: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId }, status: "ACTIVE", journey: "RENTAL", convertedTenancyId: null, intendedMoveIn: { gte: rangeStart, lt: rangeEnd } }, select: { id: true, intendedMoveIn: true, facility: { select: { name: true } }, unit: { select: { number: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } } }, orderBy: { intendedMoveIn: "asc" } }),
  ]);

  const customerName = (customer: { firstName: string | null; lastName: string | null; companyName: string | null }) => customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer";
  const items: CalendarItem[] = [
    ...tasks.flatMap((item) => item.startAt || item.dueAt ? [{ id: item.id, at: (item.startAt ?? item.dueAt)!, kind: "TASK" as const, title: item.purpose === "MEETING" ? `Meeting · ${item.title}` : item.title, detail: item.facility?.name ?? "Portfolio", href: item.purpose === "OPERATIONAL_FORM" ? `/operations/forms?id=${item.id}` : item.purpose === "OPERATIONAL_CHECKLIST" ? `/operations/checklists?id=${item.id}` : item.startAt ? "/calendar" : item.purpose === "AGREED_FOLLOWUP" ? "/operations/followups" : "/operations" }] : []),
    ...leads.flatMap((item) => item.nextActionAt ? [{ id: item.id, at: item.nextActionAt, kind: "LEAD" as const, title: `Follow up · ${customerName(item.customer ?? { firstName: null, lastName: null, companyName: null })}`, detail: item.facility.name, href: `/leads?lead=${encodeURIComponent(item.id)}` }] : []),
    ...viewings.flatMap((item) => item.viewingAt ? [{ id: item.id, at: item.viewingAt, kind: "VIEWING" as const, title: `Viewing · Unit ${item.unit.number}`, detail: `${customerName(item.customer)} · ${item.facility.name}`, href: "/reservations" }] : []),
    ...moveOuts.flatMap((item) => item.endDate ? [{ id: item.id, at: item.endDate, kind: "MOVE_OUT" as const, title: `Move-out · Unit ${item.occupancies[0]?.unit.number ?? "—"}`, detail: `${customerName(item.customer)} · ${item.facility.name}`, href: "/operations/accounts" }] : []),
    ...arrivals.flatMap(item => item.intendedMoveIn ? [{ id: item.id, at: item.intendedMoveIn, kind: "MOVE_IN" as const, title: `Expected arrival · Unit ${item.unit.number}`, detail: `${customerName(item.customer)} · ${item.facility.name} · readiness must be reviewed`, href: `/operations/arrivals?from=${southAfricaDateKey(item.intendedMoveIn)}&to=${southAfricaDateKey(item.intendedMoveIn)}` }] : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return keys.map((key) => ({ key, items: items.filter((item) => southAfricaDateKey(item.at) === key) }));
}
