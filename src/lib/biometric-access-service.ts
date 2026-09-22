
import { db } from "@/lib/db";
import { HikCentralAccessProvider } from "@/lib/integrations/hikcentral-provider";
import { loadHikCentralRuntimeConfiguration } from "@/lib/integrations/hikcentral-configuration";
import type { RequestScope } from "@/lib/scope";
import { requireFacility } from "@/lib/scope";

export const BIOMETRIC_CONSENT_POLICY = "stor24-facility-access-v1";
export const MAX_FACE_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png"]);

export function validateFaceImage(file: File) {
  if (!allowedImageTypes.has(file.type)) throw new Error("FACE_IMAGE_TYPE_INVALID");
  if (file.size < 1 || file.size > MAX_FACE_IMAGE_BYTES) throw new Error("FACE_IMAGE_SIZE_INVALID");
}

export async function listBiometricAccess(scope: RequestScope) {
  return db.biometricEnrollment.findMany({
    where: { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) },
    include: { facility: true, customer: true, occupancy: { include: { unit: true, tenancy: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

/** Direct staff uploads cannot substitute for customer consent and reviewed handover. */
export async function enrollBiometricAccess() {
  throw new Error("FACIAL_ACCESS_REQUIRES_REVIEWED_QUEUE");
}

export async function revokeBiometricAccess(scope: RequestScope, enrollmentId: string) {
  const enrollment = await db.biometricEnrollment.findFirst({ where: { id: enrollmentId, organisationId: scope.organisationId }, include: { occupancy: true } });
  if (!enrollment) throw new Error("NOT_FOUND");
  await requireFacility(scope, enrollment.facilityId);
  if (!enrollment.externalPersonId) throw new Error("BIOMETRIC_PERSON_NOT_PROVISIONED");
  const otherGrant = await db.biometricEnrollment.count({ where: { organisationId: scope.organisationId, externalPersonId: enrollment.externalPersonId, id: { not: enrollment.id }, status: { in: ["ACTIVE", "PENDING"] } } });
  if (otherGrant) throw new Error("SHARED_ACCESS_REQUIRES_RECONCILIATION");
  const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId, enrollment.facilityId));
  const result = await provider.revoke({ facilityId: enrollment.facilityId, personId: enrollment.externalPersonId });
  if (!result.ok) throw new Error(result.code);
  return db.$transaction(async (tx) => {
    const updated = await tx.biometricEnrollment.update({ where: { id: enrollment.id }, data: { status: "REVOKED", revokedAt: new Date(), retentionUntil: new Date() } });
    await tx.occupancy.update({ where: { id: enrollment.occupancyId }, data: { accessState: "REVOKED" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: enrollment.facilityId, actorId: scope.userId, action: "biometric.enrolment.revoked", entityType: "BiometricEnrollment", entityId: enrollment.id } });
    return updated;
  });
}
