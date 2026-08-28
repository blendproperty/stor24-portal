import { db } from "@/lib/db";
import { requireFacility, type RequestScope } from "@/lib/scope";
import type { OfflineLeadSyncInput } from "@/lib/validators";

export async function syncOfflineLead(scope: RequestScope, input: OfflineLeadSyncInput) {
  await requireFacility(scope, input.facilityId);
  if (input.desiredUnitTypeId) {
    const unitType = await db.unitType.findFirst({ where: { id: input.desiredUnitTypeId, facilityId: input.facilityId } });
    if (!unitType) throw new Error("FACILITY_FORBIDDEN");
  }

  const existing = await db.lead.findUnique({
    where: { offlineSubmissionId: input.submissionId },
    include: { facility: { select: { organisationId: true } } },
  });
  if (existing) {
    if (existing.facility.organisationId !== scope.organisationId || existing.facilityId !== input.facilityId) throw new Error("FORBIDDEN");
    return { leadId: existing.id, customerId: existing.customerId, idempotent: true };
  }

  try {
    return await db.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organisationId: scope.organisationId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          communicationConsent: {
            email: Boolean(input.email) && input.communicationConsent.email,
            sms: input.communicationConsent.sms,
            phone: true,
            whatsapp: input.communicationConsent.whatsapp,
            recordedAt: input.capturedAt,
            source: "OFFLINE_PWA",
          },
        },
      });
      const lead = await tx.lead.create({
        data: {
          facilityId: input.facilityId,
          customerId: customer.id,
          desiredUnitTypeId: input.desiredUnitTypeId,
          expectedMoveIn: input.expectedMoveIn ? new Date(`${input.expectedMoveIn}T00:00:00.000Z`) : undefined,
          source: "OFFLINE_PWA",
          notes: input.notes,
          offlineSubmissionId: input.submissionId,
        },
      });
      await tx.auditEvent.create({
        data: {
          organisationId: scope.organisationId,
          facilityId: input.facilityId,
          actorId: scope.userId,
          action: "offline.lead.synced",
          entityType: "Lead",
          entityId: lead.id,
          requestId: input.submissionId,
          after: { deviceId: input.deviceId, capturedAt: input.capturedAt, source: "OFFLINE_PWA", communicationConsent: input.communicationConsent },
        },
      });
      return { leadId: lead.id, customerId: customer.id, idempotent: false };
    });
  } catch (error) {
    const raced = await db.lead.findUnique({ where: { offlineSubmissionId: input.submissionId }, include: { facility: { select: { organisationId: true } } } });
    if (raced && raced.facility.organisationId === scope.organisationId && raced.facilityId === input.facilityId) return { leadId: raced.id, customerId: raced.customerId, idempotent: true };
    throw error;
  }
}
