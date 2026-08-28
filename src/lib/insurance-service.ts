import { db } from "@/lib/db";
import { facilityWhere, requireFacility, type RequestScope } from "@/lib/scope";
import { insuranceDecisionSchema, insurancePlanSchema } from "@/lib/validators";
import type { Prisma } from "@/generated/prisma/client";

export async function listInsuranceOperations(scope: RequestScope) {
  const permittedFacilityIds = scope.unrestrictedFacilities ? undefined : scope.facilityIds;
  const facilityFilter = permittedFacilityIds ? { in: permittedFacilityIds } : undefined;
  const [facilities, plans, tenancies] = await Promise.all([
    db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.insurancePlan.findMany({
      where: {
        organisationId: scope.organisationId,
        active: true,
        ...(facilityFilter ? { OR: [{ facilityId: null }, { facilityId: facilityFilter }] } : {}),
      },
      include: { facility: { select: { name: true } } },
      orderBy: [{ facilityId: "asc" }, { coverageAmount: "asc" }],
    }),
    db.tenancy.findMany({
      where: {
        facility: facilityWhere(scope),
        status: { in: ["DRAFT", "ACTIVE", "NOTICE_GIVEN"] },
      },
      include: {
        facility: { select: { id: true, name: true } },
        customer: { select: { firstName: true, lastName: true, companyName: true } },
        account: { select: { id: true, accountNumber: true } },
        occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { select: { number: true } } }, take: 1 },
        insuranceEnrollment: { include: { plan: { select: { name: true, code: true } } } },
      },
      orderBy: [{ facilityId: "asc" }, { createdAt: "desc" }],
    }),
  ]);
  return { facilities, plans, tenancies };
}

export async function createInsurancePlan(scope: RequestScope, raw: unknown) {
  const input = insurancePlanSchema.parse(raw);
  if (input.facilityId) await requireFacility(scope, input.facilityId);
  const duplicate = await db.insurancePlan.findFirst({ where: { organisationId: scope.organisationId, facilityId: input.facilityId ?? null, code: input.code } });
  if (duplicate) throw new Error("INSURANCE_PLAN_EXISTS");
  const plan = await db.insurancePlan.create({ data: { organisationId: scope.organisationId, ...input, facilityId: input.facilityId ?? null } });
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: plan.facilityId, actorId: scope.userId, action: "insurance.plan_created", entityType: "InsurancePlan", entityId: plan.id, after: { code: plan.code, coverageAmount: plan.coverageAmount.toString(), monthlyPremium: plan.monthlyPremium.toString(), policyVersion: plan.policyVersion } } });
  return plan;
}

export async function recordInsuranceDecision(scope: RequestScope, raw: unknown) {
  const input = insuranceDecisionSchema.parse(raw);
  const tenancy = await db.tenancy.findFirst({ where: { id: input.tenancyId, facility: facilityWhere(scope), status: { in: ["DRAFT", "ACTIVE", "NOTICE_GIVEN"] } }, select: { id: true, facilityId: true } });
  if (!tenancy) throw new Error("INSURANCE_TENANCY_NOT_FOUND");
  const now = new Date();

  if (input.decision === "ENROL") {
    const plan = await db.insurancePlan.findFirst({ where: { id: input.planId, organisationId: scope.organisationId, active: true, OR: [{ facilityId: null }, { facilityId: tenancy.facilityId }] } });
    if (!plan) throw new Error("INSURANCE_PLAN_NOT_AVAILABLE");
    const enrollment = await db.insuranceEnrollment.upsert({
      where: { tenancyId: tenancy.id },
      update: { planId: plan.id, status: "ACTIVE", providerName: plan.providerName, policyVersion: plan.policyVersion, coverageAmount: plan.coverageAmount, monthlyPremium: plan.monthlyPremium, excessAmount: plan.excessAmount, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`), endedAt: null, acknowledgedAt: now, waiverReason: null, createdById: scope.userId },
      create: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, tenancyId: tenancy.id, planId: plan.id, status: "ACTIVE", providerName: plan.providerName, policyVersion: plan.policyVersion, coverageAmount: plan.coverageAmount, monthlyPremium: plan.monthlyPremium, excessAmount: plan.excessAmount, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`), acknowledgedAt: now, createdById: scope.userId },
    });
    await auditDecision(scope, tenancy.facilityId, enrollment.id, "insurance.enrolled", { tenancyId: tenancy.id, planId: plan.id, policyVersion: plan.policyVersion });
    return enrollment;
  }

  if (input.decision === "WAIVE") {
    const enrollment = await db.insuranceEnrollment.upsert({
      where: { tenancyId: tenancy.id },
      update: { planId: null, status: "WAIVED", providerName: null, policyVersion: null, coverageAmount: null, monthlyPremium: null, excessAmount: null, effectiveFrom: null, endedAt: null, acknowledgedAt: now, waiverReason: input.waiverReason, createdById: scope.userId },
      create: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, tenancyId: tenancy.id, status: "WAIVED", acknowledgedAt: now, waiverReason: input.waiverReason, createdById: scope.userId },
    });
    await auditDecision(scope, tenancy.facilityId, enrollment.id, "insurance.waived", { tenancyId: tenancy.id, reason: input.waiverReason });
    return enrollment;
  }

  const current = await db.insuranceEnrollment.findFirst({ where: { tenancyId: tenancy.id, organisationId: scope.organisationId } });
  if (!current) throw new Error("INSURANCE_DECISION_NOT_FOUND");
  const enrollment = await db.insuranceEnrollment.update({ where: { id: current.id }, data: { status: "CANCELLED", endedAt: now, acknowledgedAt: now, createdById: scope.userId } });
  await auditDecision(scope, tenancy.facilityId, enrollment.id, "insurance.cancelled", { tenancyId: tenancy.id });
  return enrollment;
}

async function auditDecision(scope: RequestScope, facilityId: string, entityId: string, action: string, after: Prisma.InputJsonObject) {
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action, entityType: "InsuranceEnrollment", entityId, after } });
}
