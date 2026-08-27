import { createBlendSignLeaseEnvelope } from "@/lib/blendsign-client";
import { db } from "@/lib/db";
import { attachBlendSignEnvelope, type MoveInResult } from "@/lib/leasing-service";
import type { RequestScope } from "@/lib/scope";

export async function dispatchBlendSignLease(scope: RequestScope, result: MoveInResult, input: { paymentMethod: "DEBIT_ORDER" | "CARD" | "EFT" | "OTHER"; startDate: Date; monthlyRate?: number; simulation?: boolean }) {
  const [representative, storeProfile] = await Promise.all([
    db.user.findUnique({ where: { id: scope.userId }, select: { name: true, email: true } }),
    db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: result.facility.id, domain: "STORE_INFORMATION", name: "Default", status: "READY" }, select: { config: true } }),
  ]);
  if (!representative) throw new Error("UNAUTHENTICATED");
  const profile = await db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: result.facility.id, domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY" }, select: { config: true } });
  const config = profile?.config && typeof profile.config === "object" && !Array.isArray(profile.config) ? profile.config as Record<string, unknown> : {};
  const defaults = config.defaults && typeof config.defaults === "object" && !Array.isArray(config.defaults) ? config.defaults as Record<string, unknown> : {};
  const moveIn = defaults["Move In"] && typeof defaults["Move In"] === "object" && !Array.isArray(defaults["Move In"]) ? defaults["Move In"] as Record<string, unknown> : {};
  const envelope = await createBlendSignLeaseEnvelope({
    documentId: result.document.id,
    tenancyId: result.tenancy.id,
    paymentMethod: input.paymentMethod,
    customer: result.customer,
    facility: result.facility,
    ownerDetails: storeProfile?.config && typeof storeProfile.config === "object" && !Array.isArray(storeProfile.config) ? storeProfile.config as Record<string, unknown> : undefined,
    unit: result.unit,
    startDate: input.startDate,
    monthlyRate: Number(input.monthlyRate ?? result.unit.monthlyRate),
    representative,
    autoCountersign: moveIn.blendSignAutoCountersign === true,
    simulation: input.simulation,
  });
  await attachBlendSignEnvelope(scope, result.document.id, envelope);
  return envelope;
}

export async function retryBlendSignLease(scope: RequestScope, documentId: string) {
  const document = await db.document.findFirst({
    where: { id: documentId, provider: "BLENDSIGN", status: "PENDING", externalId: null, tenancy: { facility: { organisationId: scope.organisationId }, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) } },
    include: { tenancy: { include: { customer: true, facility: true, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { include: { unitType: true } } }, orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  const occupancy = document?.tenancy.occupancies[0];
  if (!document || !occupancy) throw new Error("NOT_FOUND");
  const paymentMethod = document.tenancy.paymentMethod;
  if (!paymentMethod || !["DEBIT_ORDER", "CARD", "EFT", "OTHER"].includes(paymentMethod)) throw new Error("INVALID_PAYMENT_METHOD");
  const [representative, storeProfile] = await Promise.all([
    db.user.findUnique({ where: { id: scope.userId }, select: { name: true, email: true } }),
    db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: document.tenancy.facilityId, domain: "STORE_INFORMATION", name: "Default", status: "READY" }, select: { config: true } }),
  ]);
  if (!representative) throw new Error("UNAUTHENTICATED");
  const profile = await db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: document.tenancy.facilityId, domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY" }, select: { config: true } });
  const config = profile?.config && typeof profile.config === "object" && !Array.isArray(profile.config) ? profile.config as Record<string, unknown> : {};
  const defaults = config.defaults && typeof config.defaults === "object" && !Array.isArray(config.defaults) ? config.defaults as Record<string, unknown> : {};
  const moveIn = defaults["Move In"] && typeof defaults["Move In"] === "object" && !Array.isArray(defaults["Move In"]) ? defaults["Move In"] as Record<string, unknown> : {};
  const envelope = await createBlendSignLeaseEnvelope({ documentId: document.id, tenancyId: document.tenancy.id, paymentMethod: paymentMethod as "DEBIT_ORDER" | "CARD" | "EFT" | "OTHER", customer: document.tenancy.customer, facility: document.tenancy.facility, ownerDetails: storeProfile?.config && typeof storeProfile.config === "object" && !Array.isArray(storeProfile.config) ? storeProfile.config as Record<string, unknown> : undefined, unit: occupancy.unit, startDate: document.tenancy.startDate, monthlyRate: Number(occupancy.monthlyRate), representative, autoCountersign: moveIn.blendSignAutoCountersign === true });
  await attachBlendSignEnvelope(scope, document.id, envelope);
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: document.tenancy.facilityId, actorId: scope.userId, action: "document.blendsign_dispatch_retried", entityType: "Document", entityId: document.id, after: { envelopeId: envelope.envelopeId, idempotent: envelope.idempotent } } });
  return envelope;
}
