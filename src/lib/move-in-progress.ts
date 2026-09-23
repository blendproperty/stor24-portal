import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { identityRequired } from "@/lib/identity-document-security";
import { resolvedPhotoPolicy } from "@/lib/facial-photo-control";

export type MoveInProgress = {
  identityStatus: string; identityAccepted: boolean; identityRequired: boolean;
  photoStatus: string; photoReviewed: boolean; photoCollectionEnabled: boolean;
  handedOver: boolean; handedOverAt: string | null; publicReference: string | null;
};

/** Metadata only, scoped to the same booking as the handover. Never returns private images. */
export async function getMoveInProgress(scope: RequestScope, reservationId: string): Promise<MoveInProgress> {
  const booking = await db.reservation.findFirst({
    where: { id: reservationId, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } },
    select: { status: true, createdAt: true, publicReference: true, convertedTenancyId: true,
      customer: { select: { email: true } },
      identityDocument: { select: { status: true, policyHash: true } },
      facialPhoto: { select: { status: true, policyHash: true, expiresAt: true, erasedAt: true, reviewedAt: true, reviewedById: true } } },
  });
  if (!booking) throw new Error("NOT_FOUND");
  const idPolicy = identityRequired(scope.organisationId, booking.createdAt, reservationId, booking.customer.email);
  const photoPolicy = await resolvedPhotoPolicy(db, scope.organisationId);
  const identityAccepted = Boolean(booking.identityDocument?.status === "ACCEPTED" && (!idPolicy || booking.identityDocument.policyHash === idPolicy.hash));
  const photo = booking.facialPhoto;
  const photoCurrent = Boolean(photo && !photo.erasedAt && (photo.expiresAt === null || photo.expiresAt > new Date()) && photo.policyHash === photoPolicy?.hash);
  const photoStored = photoCurrent && await db.facialPhotoSubmission.count({ where: { reservationId, encryptedImage: { not: null } } }) > 0;
  const handover = booking.status === "CONVERTED" && booking.convertedTenancyId ? await db.auditEvent.findFirst({
    where: { organisationId: scope.organisationId, entityType: "Tenancy", entityId: booking.convertedTenancyId, action: "tenancy.key_handover_confirmed" },
    select: { occurredAt: true }, orderBy: { occurredAt: "desc" },
  }) : null;
  return {
    identityStatus: booking.identityDocument?.status ?? "NOT_UPLOADED", identityAccepted, identityRequired: Boolean(idPolicy),
    photoStatus: photo ? photoCurrent ? photo.status : ["WITHDRAWN", "REJECTED"].includes(photo.status) ? photo.status : "EXPIRED" : "NOT_CAPTURED",
    photoReviewed: Boolean(photo?.reviewedAt && photo?.reviewedById) && photoStored && ["APPROVED", "PENDING_PROVIDER"].includes(photo!.status), photoCollectionEnabled: Boolean(photoPolicy?.enabled),
    handedOver: Boolean(handover), handedOverAt: handover?.occurredAt.toISOString() ?? null, publicReference: booking.publicReference,
  };
}
