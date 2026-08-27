import { db } from "@/lib/db";
import { requireFacility, type RequestScope } from "@/lib/scope";
import type { OfflineReservationSyncInput } from "@/lib/validators";

const HOLD_HOURS = 24;

function idempotencyKey(submissionId: string) {
  return `offline:${submissionId}`;
}

function reservationReference(capturedAt: string, submissionId: string) {
  const day = capturedAt.slice(0, 10).replaceAll("-", "");
  return `ST24-${day}-${submissionId.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

export async function syncOfflineReservation(scope: RequestScope, input: OfflineReservationSyncInput) {
  await requireFacility(scope, input.facilityId);
  const key = idempotencyKey(input.submissionId);
  const existing = await db.reservation.findUnique({
    where: { idempotencyKey: key },
    include: { facility: { select: { organisationId: true } } },
  });
  if (existing) {
    if (existing.facility.organisationId !== scope.organisationId || existing.facilityId !== input.facilityId) throw new Error("FORBIDDEN");
    return { reservationId: existing.id, reference: existing.publicReference, holdExpiresAt: existing.holdExpiresAt?.toISOString() ?? null, idempotent: true };
  }

  const lead = await db.lead.findFirst({
    where: { id: input.leadId, customerId: input.customerId, facilityId: input.facilityId, facility: { organisationId: scope.organisationId } },
    select: { id: true },
  });
  if (!lead) throw new Error("FORBIDDEN");

  try {
    return await db.$transaction(async (tx) => {
      const claimed = await tx.unit.updateMany({
        where: { id: input.unitId, facilityId: input.facilityId, status: "AVAILABLE" },
        data: { status: "RESERVED" },
      });
      if (claimed.count !== 1) throw new Error("UNIT_UNAVAILABLE");

      const holdExpiresAt = new Date(Date.now() + HOLD_HOURS * 60 * 60 * 1000);
      const reservation = await tx.reservation.create({
        data: {
          facilityId: input.facilityId,
          customerId: input.customerId,
          leadId: input.leadId,
          unitId: input.unitId,
          quotedRate: input.quotedRate,
          holdExpiresAt,
          intendedMoveIn: input.intendedMoveIn ? new Date(`${input.intendedMoveIn}T00:00:00.000Z`) : undefined,
          source: "OFFLINE_PWA",
          idempotencyKey: key,
          publicReference: reservationReference(input.capturedAt, input.submissionId),
        },
      });
      await tx.lead.updateMany({ where: { id: input.leadId, customerId: input.customerId, facilityId: input.facilityId }, data: { stage: "RESERVED" } });
      await tx.auditEvent.create({
        data: {
          organisationId: scope.organisationId,
          facilityId: input.facilityId,
          actorId: scope.userId,
          action: "offline.reservation.synced",
          entityType: "Reservation",
          entityId: reservation.id,
          requestId: input.submissionId,
          after: { deviceId: input.deviceId, capturedAt: input.capturedAt, unitId: input.unitId, source: "OFFLINE_PWA", holdExpiresAt: holdExpiresAt.toISOString() },
        },
      });
      return { reservationId: reservation.id, reference: reservation.publicReference, holdExpiresAt: holdExpiresAt.toISOString(), idempotent: false };
    });
  } catch (error) {
    const raced = await db.reservation.findUnique({ where: { idempotencyKey: key }, include: { facility: { select: { organisationId: true } } } });
    if (raced && raced.facility.organisationId === scope.organisationId && raced.facilityId === input.facilityId) {
      return { reservationId: raced.id, reference: raced.publicReference, holdExpiresAt: raced.holdExpiresAt?.toISOString() ?? null, idempotent: true };
    }
    throw error;
  }
}
