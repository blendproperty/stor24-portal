import type { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "@/lib/scope";
import { resolvedPhotoPolicy } from "@/lib/facial-photo-control";
type Database = Prisma.TransactionClient;

export async function approvedPhotoForHandover(photo: { status: string; encryptedImage: string | null; expiresAt: Date | null; erasedAt: Date | null; reviewedAt: Date | null; reviewedById: string | null; policyHash: string } | null, organisationId: string, database: Database) {
  return Boolean(photo && photo.status === "APPROVED" && photo.encryptedImage && !photo.erasedAt && photo.reviewedAt && photo.reviewedById && (photo.expiresAt === null || photo.expiresAt > new Date()) && (await resolvedPhotoPolicy(database, organisationId))?.hash === photo.policyHash);
}

/** Call inside the same locked transaction as staff handover. Never makes a provider request. */
export async function requestPhotoActivation(tx: Database, scope: RequestScope, reservationId: string, occupancyId: string) {
  const photo = await tx.facialPhotoSubmission.findUnique({ where: { reservationId } });
  if (!photo || !(await approvedPhotoForHandover(photo, scope.organisationId, tx))) throw new Error("MOVE_IN_NOT_READY");
  await tx.facialPhotoSubmission.update({ where: { id: photo.id }, data: { status: "PENDING_PROVIDER", occupancyId, activationRequestedAt: new Date() } });
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "facial_photo.activation_requested", entityType: "FacialPhotoSubmission", entityId: photo.id, after: { version: photo.version, occupancyId, providerState: "BLOCKED_CONTRACT" } } });
}

