import { handoverKeys, handoverTimes, legacyHandedOverLeadIds } from "@/lib/handover-evidence";
import { unitIsOperational, floorMapSelection } from "@/lib/floor-availability";
import { netCollectionTotal } from "@/lib/finance/collection-total";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { SOUTH_AFRICA_TIME_ZONE, southAfricaDateKey } from "@/lib/south-africa-time";

const SOUTH_AFRICA_OFFSET_MS = 2 * 60 * 60 * 1000;

function southAfricaParts(value = new Date()) {
  const [year, month, day] = southAfricaDateKey(value).split("-").map(Number);
  return { year, month: month - 1, day };
}
function startOfMonth(d: Date) {
  const { year, month } = southAfricaParts(d);
  return new Date(Date.UTC(year, month, 1) - SOUTH_AFRICA_OFFSET_MS);
}
function monthBounds(year: number, month: number) {
  return { start: new Date(Date.UTC(year, month, 1) - SOUTH_AFRICA_OFFSET_MS), end: new Date(Date.UTC(year, month + 1, 1) - SOUTH_AFRICA_OFFSET_MS) };
}
function monthLabel(d: Date) {
  return d.toLocaleDateString("en-ZA", { month: "short", timeZone: SOUTH_AFRICA_TIME_ZONE });
}
function dayLabel(d: Date) {
  return d.toLocaleDateString("en-ZA", { weekday: "short", timeZone: SOUTH_AFRICA_TIME_ZONE });
}

function last12Months(): { start: Date; end: Date; label: string }[] {
  const months: { start: Date; end: Date; label: string }[] = [];
  const { year, month } = southAfricaParts();
  for (let i = 11; i >= 0; i--) {
    const calendarMonth = new Date(Date.UTC(year, month - i, 15, 12));
    const bounds = monthBounds(calendarMonth.getUTCFullYear(), calendarMonth.getUTCMonth());
    months.push({ ...bounds, label: monthLabel(bounds.start) });
  }
  return months;
}

function last7Days(): { start: Date; end: Date; label: string; isToday: boolean }[] {
  const days: { start: Date; end: Date; label: string; isToday: boolean }[] = [];
  const { year, month, day } = southAfricaParts();
  for (let i = 6; i >= 0; i--) {
    const calendarDay = new Date(Date.UTC(year, month, day - i));
    const d = new Date(calendarDay.getTime() - SOUTH_AFRICA_OFFSET_MS);
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    days.push({ start: d, end: next, label: dayLabel(d), isToday: i === 0 });
  }
  return days;
}

export type DashboardKpis = {
  newLeadsThisWeek: number;
  activeTenancies: number;
  totalUnits: number;
  occupiedUnits: number;
  occupancyPct: number;
  handoverReviewUnits: number;
  monthToDateBilled: number;
  monthToDateCollected: number;
  collectionsRatePct: number;
  leadsThisMonth: number;
  wonThisMonth: number;
  conversionRatePct: number;
};

export async function getDashboardKpis(scope: RequestScope): Promise<DashboardKpis> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = startOfMonth(now);

  const [
    newLeadsThisWeek,
    currentTenancies,
    totalUnits,
    currentOccupancies,
    orphanedOccupiedUnits,
    billedAgg,
    collectedAgg,
    leadsThisMonth,
    cohortLeads,
  ] = await Promise.all([
    db.lead.count({ where: { facility: facilityWhere(scope), createdAt: { gte: weekAgo } } }),
    db.tenancy.findMany({ where: { facility: facilityWhere(scope), status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, select: { id: true, facilityId: true } }),
    db.unit.count({ where: { facility: facilityWhere(scope) } }),
    db.occupancy.findMany({ where: { unit: { facility: facilityWhere(scope) }, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, select: { unitId: true, tenancyId: true, unit: { select: { facilityId: true } }, tenancy: { select: { facilityId: true } } } }),
    db.unit.count({where:{facility:facilityWhere(scope),status:"OCCUPIED",occupancies:{none:{status:{in:["ACTIVE","NOTICE_GIVEN"]}}}}}),
    db.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { type: "CHARGE", effectiveAt: { gte: monthStart }, account: { tenancy: { facility: facilityWhere(scope) } } },
    }),
    netCollectionTotal(scope, monthStart),
    db.lead.count({ where: { facility: facilityWhere(scope), createdAt: { gte: monthStart } } }),
    db.lead.findMany({ where: { facility: facilityWhere(scope), createdAt: { gte: monthStart } }, select: { id:true,customerId:true,facilityId: true, reservations: { select: { status: true, convertedTenancyId: true } } } }),
  ]);

  const handedOver = await handoverKeys(scope, [...currentTenancies.map(t => t.id), ...currentOccupancies.map(o => o.tenancyId), ...cohortLeads.flatMap(l => l.reservations.flatMap(r => r.convertedTenancyId ? [r.convertedTenancyId] : []))]);
  const activeTenancies = currentTenancies.filter(t => handedOver.has(`${t.facilityId}:${t.id}`)).length;
  const byUnit = new Map<string, typeof currentOccupancies>();
  for (const occupancy of currentOccupancies) byUnit.set(occupancy.unitId, [...(byUnit.get(occupancy.unitId) ?? []), occupancy]);
  const confirmedUnits = [...byUnit.values()].filter(rows => rows.length === 1 && rows[0].unit.facilityId === rows[0].tenancy.facilityId && handedOver.has(`${rows[0].tenancy.facilityId}:${rows[0].tenancyId}`));
  const occupiedUnits = confirmedUnits.length;
  const handoverReviewUnits = byUnit.size - occupiedUnits + orphanedOccupiedUnits;
  const legacyWon=await legacyHandedOverLeadIds(scope,cohortLeads);
  const wonThisMonth = cohortLeads.filter(l => legacyWon.has(l.id) || l.reservations.some(r => r.status === "CONVERTED" && r.convertedTenancyId && handedOver.has(`${l.facilityId}:${r.convertedTenancyId}`))).length;

  const monthToDateBilled = Number(billedAgg._sum.amount ?? 0);
  const monthToDateCollected = collectedAgg;

  return {
    newLeadsThisWeek,
    activeTenancies,
    totalUnits,
    occupiedUnits,
    occupancyPct: totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0,
    handoverReviewUnits,
    monthToDateBilled,
    monthToDateCollected,
    collectionsRatePct: monthToDateBilled > 0 ? (monthToDateCollected / monthToDateBilled) * 100 : 0,
    leadsThisMonth,
    wonThisMonth,
    conversionRatePct: leadsThisMonth > 0 ? (wonThisMonth / leadsThisMonth) * 100 : 0,
  };
}

export type StagePoint = { stage: string; label: string; count: number };

const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  QUOTED: "Quoted",
  VIEWING_BOOKED: "Viewing booked",
  RESERVED: "Reserved",
  WON: "Moved in",
  HANDOVER_REVIEW: "Handover review",
  LOST: "Lost",
};

export async function getPipelineByStage(scope: RequestScope): Promise<StagePoint[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const leads = await db.lead.findMany({ where: { facility: facilityWhere(scope), createdAt: { gte: ninetyDaysAgo } }, select: { id:true,customerId:true,facilityId: true, stage: true, reservations: { select: { status: true, convertedTenancyId: true } } } });
  const handedOver = await handoverKeys(scope, leads.flatMap(l => l.reservations.flatMap(r => r.convertedTenancyId ? [r.convertedTenancyId] : [])));
  const legacyWon=await legacyHandedOverLeadIds(scope,leads);
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const moved = legacyWon.has(lead.id) || lead.reservations.some(r => r.status === "CONVERTED" && r.convertedTenancyId && handedOver.has(`${lead.facilityId}:${r.convertedTenancyId}`));
    const stage = moved ? "WON" : lead.stage === "WON" ? "HANDOVER_REVIEW" : lead.stage;
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    count: counts.get(stage) ?? 0,
  }));
}

export type DayPoint = { label: string; count: number; isToday: boolean };

export async function getLeadsLast7Days(scope: RequestScope): Promise<DayPoint[]> {
  const days = last7Days();
  const counts = await Promise.all(
    days.map((d) => db.lead.count({ where: { facility: facilityWhere(scope), createdAt: { gte: d.start, lt: d.end } } })),
  );
  return days.map((d, i) => ({ label: d.label, count: counts[i], isToday: d.isToday }));
}

export type MonthPoint = { label: string; value: number };

/** Reconstructs historical physical occupancy from real Occupancy start/end dates.
 *  Caveat: totalUnits uses the CURRENT unit count for every month (no historical
 *  inventory snapshots exist), so the trend is accurate for occupied-unit counts
 *  but the percentage denominator assumes portfolio size hasn't materially changed.
 *  Only recorded handovers count, starting no earlier than the handover audit. */
export async function getOccupancyTrend(scope: RequestScope): Promise<MonthPoint[]> {
  const months = last12Months();
  const totalUnits = await db.unit.count({ where: { facility: facilityWhere(scope) } });
  const records = await db.occupancy.findMany({
    where: { unit: { facility: facilityWhere(scope) }, status: { not: "CANCELLED" }, startDate: { lt: months[months.length - 1].end }, OR: [{ endDate: null }, { endDate: { gte: months[0].end } }] },
    select: { unitId: true, tenancyId: true, startDate: true, endDate: true, unit: { select: { facilityId: true } }, tenancy: { select: { facilityId: true } } },
  });
  const firstHandover = await handoverTimes(scope, records.map(r => r.tenancyId));
  const counts = months.map(m => new Set(records.filter(r => {
    const handover = firstHandover.get(`${r.tenancy.facilityId}:${r.tenancyId}`);
    return r.unit.facilityId === r.tenancy.facilityId && handover && handover < m.end && r.startDate < m.end && (!r.endDate || r.endDate >= m.end);
  }).map(r => r.unitId)).size);
  return months.map((m, i) => ({ label: m.label, value: totalUnits > 0 ? Math.round((counts[i] / totalUnits) * 1000) / 10 : 0 }));
}

export async function getRevenueTrend(scope: RequestScope): Promise<{ label: string; billed: number; collected: number }[]> {
  const months = last12Months();
  const results = await Promise.all(
    months.map(async (m) => {
      const [billedAgg, collectedAgg] = await Promise.all([
        db.ledgerEntry.aggregate({
          _sum: { amount: true },
          where: { type: "CHARGE", effectiveAt: { gte: m.start, lt: m.end }, account: { tenancy: { facility: facilityWhere(scope) } } },
        }),
        netCollectionTotal(scope, m.start, m.end),
      ]);
      return { label: m.label, billed: Number(billedAgg._sum.amount ?? 0), collected: collectedAgg };
    }),
  );
  return results;
}

export type FacilityUnitStats = {
  facilityId: string;
  facilityName: string;
  total: number;
  available: number;
  reserved: number;
  occupied: number;
  service: number;
  occupancyPct: number;
  handoverReview: number;
};

export async function getUnitStatsByFacility(scope: RequestScope): Promise<FacilityUnitStats[]> {
  const facilities = await db.facility.findMany({
    where: facilityWhere(scope),
    select: { id: true, name: true, closedFloors: true, units: { select: { status: true, floor: true, mapElements: floorMapSelection, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, select: { tenancyId: true, tenancy: { select: { facilityId: true } } } } } } },
    orderBy: { name: "asc" },
  });
  const handedOver = await handoverKeys(scope, facilities.flatMap(f => f.units.flatMap(u => u.occupancies.map(o => o.tenancyId))));
  return facilities.map(facility => {
    const total = facility.units.length;
    const occupied = facility.units.filter(unit => (unit.occupancies.length === 1 && unit.occupancies[0].tenancy.facilityId === facility.id && handedOver.has(`${facility.id}:${unit.occupancies[0].tenancyId}`))).length;
    const handoverReview = facility.units.filter(unit => (unit.occupancies.length > 0 || unit.status === "OCCUPIED") && !(unit.occupancies.length === 1 && unit.occupancies[0].tenancy.facilityId === facility.id && handedOver.has(`${facility.id}:${unit.occupancies[0].tenancyId}`))).length;
    return {
      facilityId: facility.id, facilityName: facility.name, total, occupied, handoverReview,
      available: facility.units.filter(unit => unit.status === "AVAILABLE" && unitIsOperational(unit, facility.closedFloors)).length,
      reserved: facility.units.filter(unit => ["RESERVED", "HELD"].includes(unit.status)).length,
      service: facility.units.filter(unit => ["SERVICE", "UNAVAILABLE"].includes(unit.status) || (unit.status === "AVAILABLE" && !unitIsOperational(unit, facility.closedFloors))).length,
      occupancyPct: total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0,
    };
  });
}

export async function getOperationsHome(scope: RequestScope) {
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const facilityIds = scope.unrestrictedFacilities ? null : scope.facilityIds;
  const optionalFacilityScope = facilityIds ? { OR: [{ facilityId: null }, { facilityId: { in: facilityIds } }] } : {};

  const [kpis, receivables, activeLeads, overdueAccounts, expiringReservations, dueTasks, followUpLeads, activity] = await Promise.all([
    getDashboardKpis(scope),
    db.account.aggregate({ _sum: { balance: true }, where: { tenancy: { facility: facilityWhere(scope) } } }),
    db.lead.count({ where: { facility: facilityWhere(scope), stage: { notIn: ["WON", "LOST"] } } }),
    db.account.count({ where: { balance: { gt: 0 }, tenancy: { facility: facilityWhere(scope) } } }),
    db.reservation.count({ where: { facility: facilityWhere(scope), status: "ACTIVE", holdExpiresAt: { lte: threeDaysFromNow } } }),
    db.task.count({ where: { organisationId: scope.organisationId, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueAt: { lte: threeDaysFromNow }, ...optionalFacilityScope } }),
    db.lead.count({ where: { facility: facilityWhere(scope), stage: { notIn: ["WON", "LOST"] }, nextActionAt: { lte: threeDaysFromNow } } }),
    db.auditEvent.findMany({ where: { organisationId: scope.organisationId, ...optionalFacilityScope }, include: { actor: { select: { name: true } }, facility: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 8 }),
  ]);

  return {
    metrics: { occupancyPct: kpis.occupancyPct, occupiedUnits: kpis.occupiedUnits, totalUnits: kpis.totalUnits, receivables: Number(receivables._sum.balance ?? 0), overdueAccounts, activeLeads, newLeadsThisWeek: kpis.newLeadsThisWeek },
    queue: { expiringReservations, dueTasks, followUpLeads },
    activity,
  };
}
