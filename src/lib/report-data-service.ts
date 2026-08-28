import { db } from "@/lib/db";
import { requireFacility, type RequestScope } from "@/lib/scope";
import type { ReportParameters } from "@/lib/reporting";

export type ReportRow = Record<string, string | number | boolean | null>;

export async function buildReportRows(scope: RequestScope, parameters: ReportParameters): Promise<ReportRow[]> {
  if (parameters.facilityId) await requireFacility(scope, parameters.facilityId);
  const facilityId = parameters.facilityId ? parameters.facilityId : scope.unrestrictedFacilities ? undefined : { in: scope.facilityIds };
  const from = new Date(`${parameters.from}T00:00:00.000Z`);
  const to = new Date(`${parameters.to}T23:59:59.999Z`);
  const facility = { organisationId: scope.organisationId, ...(facilityId ? { id: facilityId } : {}) };

  switch (parameters.reportKey) {
    case "occupancy-revenue": {
      const facilities = await db.facility.findMany({ where: facility, include: { units: { include: { unitType: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, select: { monthlyRate: true } } } } }, orderBy: { name: "asc" } });
      return facilities.map((item) => {
        const occupied = item.units.filter((unit) => unit.occupancies.length);
        const potentialRent = item.units.reduce((sum, unit) => sum + Number(unit.monthlyRate), 0);
        const achievedRent = occupied.reduce((sum, unit) => sum + Number(unit.occupancies[0].monthlyRate), 0);
        return { facility: item.name, totalUnits: item.units.length, occupiedUnits: occupied.length, physicalOccupancyPercent: item.units.length ? Number((occupied.length / item.units.length * 100).toFixed(2)) : 0, monthlyOccupiedRent: achievedRent, potentialMonthlyRent: potentialRent, economicOccupancyPercent: potentialRent ? Number((achievedRent / potentialRent * 100).toFixed(2)) : 0 };
      });
    }
    case "unit-availability": {
      const units = await db.unit.findMany({ where: { facility }, include: { facility: { select: { name: true } }, unitType: { select: { name: true, areaSqMetres: true } }, reservations: { where: { status: "ACTIVE" }, select: { holdExpiresAt: true }, take: 1 } }, orderBy: [{ facilityId: "asc" }, { number: "asc" }] });
      return units.map((unit) => ({ facility: unit.facility.name, unit: unit.number, type: unit.unitType.name, areaSqMetres: unit.unitType.areaSqMetres === null ? null : Number(unit.unitType.areaSqMetres), status: unit.status, monthlyRate: Number(unit.monthlyRate), activeHoldExpiresAt: unit.reservations[0]?.holdExpiresAt?.toISOString() ?? null }));
    }
    case "move-activity": {
      const occupancies = await db.occupancy.findMany({ where: { tenancy: { facility }, OR: [{ startDate: { gte: from, lte: to } }, { endDate: { gte: from, lte: to } }] }, include: { unit: { select: { number: true } }, tenancy: { include: { facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } }, account: { select: { accountNumber: true } } } } }, orderBy: { startDate: "asc" } });
      return occupancies.map((item) => ({ facility: item.tenancy.facility.name, account: item.tenancy.account.accountNumber, customer: item.tenancy.customer.companyName || [item.tenancy.customer.firstName, item.tenancy.customer.lastName].filter(Boolean).join(" "), unit: item.unit.number, status: item.status, moveIn: item.startDate.toISOString(), moveOut: item.endDate?.toISOString() ?? null, monthlyRate: Number(item.monthlyRate) }));
    }
    case "lead-conversion": {
      const leads = await db.lead.findMany({ where: { facility, createdAt: { gte: from, lte: to } }, include: { facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } }, assignedTo: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
      return leads.map((lead) => ({ facility: lead.facility.name, createdAt: lead.createdAt.toISOString(), source: lead.source, stage: lead.stage, customer: lead.customer?.companyName || [lead.customer?.firstName, lead.customer?.lastName].filter(Boolean).join(" ") || "Unlinked", assignedTo: lead.assignedTo?.name ?? "Unassigned", expectedMoveIn: lead.expectedMoveIn?.toISOString() ?? null, nextActionAt: lead.nextActionAt?.toISOString() ?? null }));
    }
    case "rent-roll":
    case "receivables-ageing":
    case "collections-performance": {
      const tenancies = await db.tenancy.findMany({ where: { facility, status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, ...(parameters.reportKey === "rent-roll" ? {} : { account: { balance: { gt: 0 } } }) }, include: { facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } }, account: { include: { ledgerEntries: { where: { effectiveAt: { gte: from, lte: to } }, orderBy: { effectiveAt: "asc" } } } }, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { select: { number: true } } }, take: 1 } }, orderBy: { facilityId: "asc" } });
      return tenancies.map((item) => ({ facility: item.facility.name, account: item.account.accountNumber, customer: item.customer.companyName || [item.customer.firstName, item.customer.lastName].filter(Boolean).join(" "), unit: item.occupancies[0]?.unit.number ?? null, tenancyStatus: item.status, monthlyRate: item.occupancies[0] ? Number(item.occupancies[0].monthlyRate) : null, balance: Number(item.account.balance), periodLedgerEntries: item.account.ledgerEntries.length, oldestPeriodEntry: item.account.ledgerEntries[0]?.effectiveAt.toISOString() ?? null }));
    }
    case "insurance-participation": {
      const enrollments = await db.insuranceEnrollment.findMany({ where: { organisationId: scope.organisationId, ...(facilityId ? { facilityId } : {}), acknowledgedAt: { lte: to } }, include: { facility: { select: { name: true } }, tenancy: { include: { customer: { select: { firstName: true, lastName: true, companyName: true } }, account: { select: { accountNumber: true } }, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { select: { number: true } } }, take: 1 } } }, plan: { select: { code: true, name: true } } }, orderBy: { acknowledgedAt: "asc" } });
      return enrollments.map((item) => ({ facility: item.facility.name, account: item.tenancy.account.accountNumber, customer: item.tenancy.customer.companyName || [item.tenancy.customer.firstName, item.tenancy.customer.lastName].filter(Boolean).join(" "), unit: item.tenancy.occupancies[0]?.unit.number ?? null, status: item.status, planCode: item.plan?.code ?? null, plan: item.plan?.name ?? null, provider: item.providerName, coverageAmount: item.coverageAmount === null ? null : Number(item.coverageAmount), monthlyPremium: item.monthlyPremium === null ? null : Number(item.monthlyPremium), waiverReason: item.waiverReason, acknowledgedAt: item.acknowledgedAt.toISOString() }));
    }
    case "integration-health": {
      const connections = await db.integrationConnection.findMany({ where: { organisationId: scope.organisationId, ...(facilityId ? { facilityId } : {}) }, include: { facility: { select: { name: true } } }, orderBy: [{ category: "asc" }, { provider: "asc" }] });
      return connections.map((item) => ({ facility: item.facility?.name ?? "Organisation-wide", category: item.category, provider: item.provider, status: item.status, lastHealthAt: item.lastHealthAt?.toISOString() ?? null, lastSuccessAt: item.lastSuccessAt?.toISOString() ?? null, lastFailureAt: item.lastFailureAt?.toISOString() ?? null, consecutiveFailures: item.consecutiveFailures, failureCode: item.failureCode, failureMessage: item.failureMessage }));
    }
    default:
      throw new Error("REPORT_NOT_IMPLEMENTED");
  }
}
