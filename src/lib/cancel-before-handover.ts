import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import type { OccupancyStatus } from "@/generated/prisma/client";

const protectedOccupancy: OccupancyStatus[] = ["PENDING", "ACTIVE", "NOTICE_GIVEN", "TRANSFERRING"];

export const cancellationMessages: Record<string, string> = {
  NOT_FOUND: "This booking is unavailable in your permitted stores.",
  CANCEL_HANDOVER_STATE: "This signed booking no longer qualifies for cancellation before key handover. Refresh and review the booking, unit and access state.",
  CANCEL_HANDOVER_FINANCE: "Finance must clear the booking balance, pending payments, adjustments and any mandate before cancellation. Use an approved ledger correction or refund workflow as appropriate.",
};

/** Close one signed booking and its pending allocation while retaining the signed agreement and ledger. */
export async function cancelBeforeHandover(scope: RequestScope, reservationId: string, reason: string) {
  return db.$transaction(async tx => {
    const target = await tx.reservation.findFirst({ where: { id: reservationId, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } }, select: { facilityId: true, unitId: true } });
    if (!target) throw new Error("NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${target.facilityId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id" = ${target.unitId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE`;
    const booking = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: {
      unit: { select: { status: true, combinedIntoUnitId: true } },
      publicLease: { select: { status: true, signedAt: true, signedPdfSha256: true, mandate: { select: { id: true } } } },
      facialPhoto: { select: { activationRequestedAt: true } },
    } });
    if (booking.status === "CANCELLED" && await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, facilityId: booking.facilityId, entityType: "Reservation", entityId: reservationId, action: "reservation.cancelled_before_handover" }, select: { id: true } })) return;
    if (booking.unitId !== target.unitId || booking.facilityId !== target.facilityId || booking.journey !== "RENTAL" || booking.unit.combinedIntoUnitId || booking.facialPhoto?.activationRequestedAt) throw new Error("CANCEL_HANDOVER_STATE");

    let accountId: string | undefined;
    let occupancyId: string | undefined;
    const tenancyId = booking.convertedTenancyId;
    if (booking.status === "CONVERTED" && tenancyId) {
      await tx.$queryRaw`SELECT "id" FROM "Tenancy" WHERE "id" = ${tenancyId} FOR UPDATE`;
      const tenancy = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId }, include: {
        occupancies: { where: { status: { in: protectedOccupancy } }, select: { id: true, status: true, unitId: true, accessState: true, biometricEnrollments: { select: { id: true }, take: 1 } } },
        documents: { where: { type: "LEASE_AGREEMENT", status: "SIGNED", signedAt: { not: null } }, select: { id: true }, take: 1 },
        legacyAccessPhoto: { select: { activationRequestedAt: true } }, mandateSession: { select: { mandate: { select: { id: true } } } },
      } });
      const occupancy = tenancy.occupancies[0];
      const handover = await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, entityType: "Tenancy", entityId: tenancyId, action: "tenancy.key_handover_confirmed" }, select: { id: true } });
      if (handover || tenancy.facilityId !== booking.facilityId || tenancy.customerId !== booking.customerId || tenancy.status !== "DRAFT" || !tenancy.documents.length || tenancy.occupancies.length !== 1 || occupancy.unitId !== booking.unitId || occupancy.status !== "PENDING" || occupancy.accessState !== "PENDING" || occupancy.biometricEnrollments.length || tenancy.legacyAccessPhoto?.activationRequestedAt) throw new Error("CANCEL_HANDOVER_STATE");
      if (tenancy.mandateSession?.mandate) throw new Error("CANCEL_HANDOVER_FINANCE");
      accountId = tenancy.accountId;
      occupancyId = occupancy.id;
    } else {
      if (booking.status !== "ACTIVE" || tenancyId || booking.publicLease?.status !== "SIGNED" || !booking.publicLease.signedAt || !booking.publicLease.signedPdfSha256) throw new Error("CANCEL_HANDOVER_STATE");
      accountId = (await tx.account.findUnique({ where: { accountNumber: `ST24-T-${booking.id}` }, select: { id: true } }))?.id;
    }

    if (booking.publicLease?.mandate || await tx.publicPaymentSession.count({ where: { reservationId, provider: { not: "STOR24_SIMULATOR" }, status: { notIn: ["FAILED", "EXPIRED", "CANCELLED"] } } })) throw new Error("CANCEL_HANDOVER_FINANCE");
    if (accountId) {
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
      const account = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { customerId: true, balance: true, tenancy: { select: { id: true } } } });
      if (account.customerId !== booking.customerId || (account.tenancy?.id ?? null) !== tenancyId) throw new Error("CANCEL_HANDOVER_STATE");
      if (!account.balance.isZero() || await tx.payment.count({ where: { accountId, status: { in: ["PENDING", "SUCCEEDED", "PARTIALLY_REFUNDED"] } } }) || await tx.financialAdjustment.count({ where: { accountId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } } })) throw new Error("CANCEL_HANDOVER_FINANCE");
    }

    const history = { organisationId: scope.organisationId, facilityId: booking.facilityId, actorId: scope.userId };
    const now = new Date();
    if (tenancyId && occupancyId) {
      await tx.occupancy.update({ where: { id: occupancyId }, data: { status: "CANCELLED", accessState: "REVOKED", endDate: now } });
      await tx.tenancy.update({ where: { id: tenancyId }, data: { status: "CANCELLED", endDate: now } });
      await tx.auditEvent.create({ data: { ...history, action: "tenancy.cancelled_before_handover", entityType: "Tenancy", entityId: tenancyId, before: { status: "DRAFT" }, after: { status: "CANCELLED", reservationId, reason } } });
    }
    await tx.reservation.update({ where: { id: reservationId }, data: { status: "CANCELLED", identityAccessHash: null, identityAccessExpiresAt: null } });
    const protectedUnit = await tx.occupancy.count({ where: { unitId: booking.unitId, status: { in: protectedOccupancy } } }) || await tx.reservation.count({ where: { unitId: booking.unitId, status: "ACTIVE" } });
    const release = protectedUnit ? null : await tx.unit.updateMany({ where: { id: booking.unitId, status: { in: tenancyId ? ["RESERVED", "OCCUPIED"] : ["RESERVED"] } }, data: { status: "AVAILABLE" } });
    if (booking.leadId) {
      await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${booking.leadId} FOR UPDATE`;
      const lead = await tx.lead.findFirst({ where: { id: booking.leadId, customerId: booking.customerId, facilityId: booking.facilityId, stage: { notIn: ["LOST", "WON"] }, reservations: { none: { status: { in: ["ACTIVE", "CONVERTED"] } } } }, select: { id: true, stage: true } });
      if (lead) {
        await tx.lead.update({ where: { id: lead.id }, data: { stage: "LOST", lossReason: reason, nextActionAt: null } });
        await tx.auditEvent.create({ data: { ...history, action: "lead.stage_changed", entityType: "Lead", entityId: lead.id, before: { stage: lead.stage }, after: { stage: "LOST", reservationId, reason } } });
      }
    }
    await tx.auditEvent.create({ data: { ...history, action: "reservation.cancelled_before_handover", entityType: "Reservation", entityId: reservationId, before: { status: booking.status }, after: { status: "CANCELLED", reason, tenancyId, unitId: booking.unitId, unitReleased: release?.count === 1 } } });
  });
}
