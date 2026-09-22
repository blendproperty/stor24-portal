import type { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "@/lib/scope";
import { facialPhotoPolicy } from "@/lib/facial-photo-security";
type Database = Prisma.TransactionClient;

/** Call inside the same locked transaction as staff handover. Never makes a provider request. */
export async function requestPhotoActivation(tx: Database, scope: RequestScope, reservationId: string, occupancyId: string) {
  const photo = await tx.facialPhotoSubmission.findUnique({ where: { reservationId } });
  if (!photo || photo.status !== "APPROVED" || !photo.encryptedImage || photo.expiresAt <= new Date() || facialPhotoPolicy(scope.organisationId)?.hash !== photo.policyHash) return;
  await tx.facialPhotoSubmission.update({ where: { id: photo.id }, data: { status: "PENDING_PROVIDER", occupancyId, activationRequestedAt: new Date() } });
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "facial_photo.activation_requested", entityType: "FacialPhotoSubmission", entityId: photo.id, after: { version: photo.version, occupancyId, providerState: "BLOCKED_CONTRACT" } } });
}

