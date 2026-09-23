import { requireOperationalUnit } from "@/lib/floor-availability-service";
import { unitIsOperational, floorMapSelection } from "@/lib/floor-availability";
import { identityGate } from "@/lib/identity-document-service";
import { approvedPhotoForHandover, requestPhotoActivation } from "@/lib/facial-photo-activation";
import { isTestPayment } from "@/lib/payments/payment-evidence";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";

type Database = Prisma.TransactionClient;
const reservationInclude = {
  facility: { select: { closedFloors: true } },
  publicLease: { select: { id: true, status: true, signedAt: true, signedPdfSha256: true, paymentMethod: true, mandate: { select: { status: true } } } },
  packageSelection: { select: { priceSnapshot: true } },
  convertedTenancy: { select: { status: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, select: { unitId: true } } } },
  unit: { select: { mapElements: floorMapSelection, floor: true, status: true, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN", "TRANSFERRING"] } }, select: { id: true } } } },
} satisfies Prisma.ReservationInclude;

/** Use the exact booking account. Shopping, test receipts and another unit's payments cannot clear a move-in. */
export async function reservationReadiness(database: Database, scope: RequestScope, reservationId: string, forPhoto = false) {
  const reservation = await database.reservation.findFirst({
    where: { id: reservationId, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } },
    include: reservationInclude,
  });
  if (!reservation) throw new Error("NOT_FOUND");
  const account = await database.account.findFirst({
    where: { accountNumber: `ST24-T-${reservation.id}`, customerId: reservation.customerId },
    include: { payments: { include: { merchandiseOrder: { select: { id: true } } } }, ledgerEntries: true, tenancy: { select: { id: true } } },
  });
  const requiredCents = Math.round(Number(reservation.quotedRate) * 100) + Math.round(Number(reservation.packageSelection?.priceSnapshot ?? 0) * 100);
  const receipts = account?.payments.filter(payment => {
    if (payment.status !== "SUCCEEDED" || payment.currency !== "ZAR" || !payment.processedAt || payment.merchandiseOrder) return false;
    if (isTestPayment(payment)) return false;
    return account.ledgerEntries.some(entry => {
      const metadata = entry.metadata as { paymentId?: string; verifiedStatus?: unknown; environment?: string } | null;
      const matches = payment.provider === "NETCASH"
        ? metadata?.paymentId === payment.id && Boolean(metadata.verifiedStatus) && metadata.environment === "live"
        : !payment.provider && entry.externalRef === payment.idempotencyKey && Boolean(entry.createdById);
      return matches && entry.type === "PAYMENT" && entry.amount.equals(payment.amount) &&
        !account.ledgerEntries.some(reversal => reversal.reversalOfId === entry.id);
    });
  }) ?? [];
  const paidCents = receipts.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
  const testPayment = account?.payments.some(isTestPayment) ?? false;
  const signed = reservation.publicLease?.status === "SIGNED" && Boolean(reservation.publicLease.signedAt && reservation.publicLease.signedPdfSha256);
  const startDate = reservation.intendedMoveIn ? southAfricaDateKey(reservation.intendedMoveIn) : null;
  const blockers: string[] = [];
  if (!unitIsOperational(reservation.unit, reservation.facility.closedFloors)) blockers.push("This floor is not operational. Staff must arrange an operational unit before move-in.");
  if (!forPhoto && !(await identityGate(database, scope.organisationId, reservation.id, reservation.createdAt, "HANDOVER"))) blockers.push("The identity document needs staff acceptance before key handover.");
  // Photo collection eligibility must not depend on approval of the photo being collected.
  if (!forPhoto && !approvedPhotoForHandover(await database.facialPhotoSubmission.findUnique({ where: { reservationId } }), scope.organisationId)) blockers.push("A current, staff-approved access photo is required before key handover.");
  const handedOver = forPhoto && reservation.status === "CONVERTED" && reservation.convertedTenancyId &&
    ["ACTIVE", "NOTICE_GIVEN"].includes(reservation.convertedTenancy?.status ?? "") && reservation.convertedTenancy?.occupancies.some(occupancy => occupancy.unitId === reservation.unitId) &&
    Boolean(await database.auditEvent.findFirst({ where: { organisationId: scope.organisationId, entityId: reservation.convertedTenancyId, action: "tenancy.key_handover_confirmed" }, select: { id: true } }));
  if (!handedOver && (reservation.status !== "ACTIVE" || reservation.convertedTenancyId)) blockers.push("This reservation is no longer awaiting move-in. Refresh to view its current account.");
  if (reservation.journey !== "RENTAL") blockers.push("Convert the viewing enquiry to a rental booking before move-in.");
  if (!handedOver && (reservation.unit.status !== "RESERVED" || reservation.unit.occupancies.length)) blockers.push("The unit's availability needs review before key collection.");
  if (!signed) blockers.push("The signed agreement and completed document must be on this booking.");
  if (!startDate) blockers.push("The agreed move-in date is missing. Review the booking.");
  else if (!forPhoto && startDate > southAfricaDateKey(new Date())) blockers.push(`Key collection starts on ${startDate}.`);
  if (!account || (handedOver ? account.tenancy?.id !== reservation.convertedTenancyId : account.tenancy)) blockers.push("The booking account needs reconciliation before move-in.");
  if (requiredCents <= 0 || paidCents < requiredCents) blockers.push(testPayment
    ? "A test payment is recorded. It does not clear the real booking for key collection."
    : "The required booking payment has not been verified in full on this account.");
  if (account?.ledgerEntries.some(entry => entry.type === "REFUND" || entry.type === "REVERSAL")) blockers.push("A refund or reversal requires account review before key collection.");
  return { reservation, account, receipts, view: {
    mandateStatus: reservation.publicLease?.paymentMethod === "DEBIT_ORDER" ? reservation.publicLease.mandate?.status ?? "NOT_STARTED" : null,
    signed, leaseId: reservation.publicLease?.id ?? null, signedAt: reservation.publicLease?.signedAt?.toISOString() ?? null,
    requiredAmount: requiredCents / 100, paidAmount: paidCents / 100,
    paymentVerified: requiredCents > 0 && paidCents >= requiredCents,
    testPayment, startDate, ready: blockers.length === 0, blockers,
  } };
}

export type ReservationMoveInReadiness = Awaited<ReturnType<typeof reservationReadiness>>["view"];

export async function getReservationMoveInReadiness(scope: RequestScope, reservationId: string) {
  return (await reservationReadiness(db, scope, reservationId)).view;
}

/** Caller authorises move_in.create for this facility. No signing dispatch, payment posting or door provisioning. */
export async function confirmReservationMoveIn(scope: RequestScope, reservationId: string) {
  return db.$transaction(async tx => {
    const target = await tx.reservation.findFirst({ where: { id: reservationId, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } }, select: { unitId: true, facilityId: true } });
    if (!target) throw new Error("NOT_FOUND");
    await requireOperationalUnit(tx, target.facilityId, target.unitId);
    await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id" = ${target.unitId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE`;
    const existing = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (existing.status === "CONVERTED" && existing.convertedTenancyId) {
      const handover = await tx.auditEvent.findFirst({ where: { entityId: existing.convertedTenancyId, action: "tenancy.key_handover_confirmed", organisationId: scope.organisationId } });
      if (handover) return { tenancyId: existing.convertedTenancyId, idempotent: true };
      throw new Error("MOVE_IN_REVIEW_REQUIRED");
    }
    const accountNumber = `ST24-T-${reservationId}`;
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "accountNumber" = ${accountNumber} FOR UPDATE`;
    const state = await reservationReadiness(tx, scope, reservationId);
    if (!state.view.ready || !state.account || !state.reservation.intendedMoveIn) throw new Error("MOVE_IN_NOT_READY");
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: target.unitId } });
    const occupied = await tx.occupancy.count({ where: { unitId: unit.id, status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN", "TRANSFERRING"] } } });
    const otherReservation = await tx.reservation.count({ where: { unitId: unit.id, status: "ACTIVE", id: { not: reservationId } } });
    if (unit.status !== "RESERVED" || occupied || otherReservation) throw new Error("MOVE_IN_REVIEW_REQUIRED");
    const lease = await tx.publicReservationLease.findUniqueOrThrow({ where: { reservationId } });
    if (!lease.signedPdf || createHash("sha256").update(lease.signedPdf).digest("hex") !== lease.signedPdfSha256 || createHash("sha256").update(lease.content).digest("hex") !== lease.sha256) throw new Error("MOVE_IN_DOCUMENT_REVIEW");
    const tenancy = await tx.tenancy.create({ data: {
      facilityId: existing.facilityId, customerId: existing.customerId, accountId: state.account.id,
      status: "ACTIVE", startDate: state.reservation.intendedMoveIn, paymentMethod: lease.paymentMethod,
      occupancies: { create: { unitId: unit.id, status: "ACTIVE", startDate: state.reservation.intendedMoveIn, monthlyRate: existing.quotedRate, accessState: "PENDING" } },
      documents: { create: { type: "LEASE_AGREEMENT", provider: "PUBLIC_RESERVATION", externalId: lease.id, storageKey: `public-reservation:${lease.id}`, status: "SIGNED", content: lease.content, sha256: lease.sha256, signerName: lease.signerName, signerIp: lease.signerIp, signerUserAgent: lease.signerUserAgent, clauseVersion: lease.version, signedAt: lease.signedAt, idempotencyKey: `reservation-lease:${lease.id}` } },
    } });
    const occupancy = await tx.occupancy.findFirstOrThrow({ where: { tenancyId: tenancy.id, unitId: unit.id } });
    await requestPhotoActivation(tx, scope, reservationId, occupancy.id);
    const claimed = await tx.reservation.updateMany({ where: { id: reservationId, status: "ACTIVE", convertedTenancyId: null }, data: { status: "CONVERTED", convertedTenancyId: tenancy.id } });
    if (claimed.count !== 1) throw new Error("CONFLICT");
    await tx.unit.update({ where: { id: unit.id }, data: { status: "OCCUPIED" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: existing.facilityId, actorId: scope.userId, action: "tenancy.key_handover_confirmed", entityType: "Tenancy", entityId: tenancy.id, after: { reservationId, accountId: state.account.id, leaseId: lease.id, paymentIds: state.receipts.map(payment => payment.id), requiredAmount: state.view.requiredAmount, paidAmount: state.view.paidAmount, accessState: "PENDING" } } });
    return { tenancyId: tenancy.id, idempotent: false };
  });
}
