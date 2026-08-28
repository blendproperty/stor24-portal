import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function monthLabel(d: Date) {
  return d.toLocaleDateString("en-ZA", { month: "short" });
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayLabel(d: Date) {
  return d.toLocaleDateString("en-ZA", { weekday: "short" });
}

function last12Months(): { start: Date; end: Date; label: string }[] {
  const months: { start: Date; end: Date; label: string }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ start: startOfMonth(monthDate), end: endOfMonth(monthDate), label: monthLabel(monthDate) });
  }
  return months;
}

function last7Days(): { start: Date; end: Date; label: string; isToday: boolean }[] {
  const days: { start: Date; end: Date; label: string; isToday: boolean }[] = [];
  const today = startOfDay(new Date());
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
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
    activeTenancies,
    totalUnits,
    occupiedUnits,
    billedAgg,
    collectedAgg,
    leadsThisMonth,
    wonThisMonth,
  ] = await Promise.all([
    db.lead.count({ where: { facility: facilityWhere(scope), createdAt: { gte: weekAgo } } }),
    db.tenancy.count({ where: { facility: facilityWhere(scope), status: "ACTIVE" } }),
    db.unit.count({ where: { facility: facilityWhere(scope) } }),
    db.unit.count({ where: { facility: facilityWhere(scope), status: "OCCUPIED" } }),
    db.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { type: "CHARGE", effectiveAt: { gte: monthStart }, account: { tenancy: { facility: facilityWhere(scope) } } },
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: { status: "SUCCEEDED", processedAt: { gte: monthStart }, account: { tenancy: { facility: facilityWhere(scope) } } },
    }),
    db.lead.count({ where: { facility: facilityWhere(scope), createdAt: { gte: monthStart } } }),
    db.lead.count({ where: { facility: facilityWhere(scope), stage: "WON", updatedAt: { gte: monthStart } } }),
  ]);

  const monthToDateBilled = Number(billedAgg._sum.amount ?? 0);
  const monthToDateCollected = Number(collectedAgg._sum.amount ?? 0);

  return {
    newLeadsThisWeek,
    activeTenancies,
    totalUnits,
    occupiedUnits,
    occupancyPct: totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0,
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
  WON: "Won",
  LOST: "Lost",
};

export async function getPipelineByStage(scope: RequestScope): Promise<StagePoint[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const grouped = await db.lead.groupBy({
    by: ["stage"],
    where: { facility: facilityWhere(scope), createdAt: { gte: ninetyDaysAgo } },
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((g) => [g.stage, g._count._all]));
  return Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    count: counts.get(stage as never) ?? 0,
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
 *  but the percentage denominator assumes portfolio size hasn't materially changed. */
export async function getOccupancyTrend(scope: RequestScope): Promise<MonthPoint[]> {
  const months = last12Months();
  const totalUnits = await db.unit.count({ where: { facility: facilityWhere(scope) } });
  const counts = await Promise.all(
    months.map((m) =>
      db.occupancy.count({
        where: {
          unit: { facility: facilityWhere(scope) },
          status: { not: "CANCELLED" },
          startDate: { lt: m.end },
          OR: [{ endDate: null }, { endDate: { gte: m.end } }],
        },
      }),
    ),
  );
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
        db.payment.aggregate({
          _sum: { amount: true },
          where: { status: "SUCCEEDED", processedAt: { gte: m.start, lt: m.end }, account: { tenancy: { facility: facilityWhere(scope) } } },
        }),
      ]);
      return { label: m.label, billed: Number(billedAgg._sum.amount ?? 0), collected: Number(collectedAgg._sum.amount ?? 0) };
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
};

export async function getUnitStatsByFacility(scope: RequestScope): Promise<FacilityUnitStats[]> {
  const facilities = await db.facility.findMany({
    where: facilityWhere(scope),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const stats = await Promise.all(
    facilities.map(async (facility) => {
      const [total, available, reserved, occupied, service] = await Promise.all([
        db.unit.count({ where: { facilityId: facility.id } }),
        db.unit.count({ where: { facilityId: facility.id, status: "AVAILABLE" } }),
        db.unit.count({ where: { facilityId: facility.id, status: { in: ["RESERVED", "HELD"] } } }),
        db.unit.count({ where: { facilityId: facility.id, status: "OCCUPIED" } }),
        db.unit.count({ where: { facilityId: facility.id, status: { in: ["SERVICE", "UNAVAILABLE"] } } }),
      ]);
      return {
        facilityId: facility.id,
        facilityName: facility.name,
        total,
        available,
        reserved,
        occupied,
        service,
        occupancyPct: total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0,
      };
    }),
  );
  return stats;
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
