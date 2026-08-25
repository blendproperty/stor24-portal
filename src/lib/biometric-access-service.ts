import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { HikCentralAccessProvider } from "@/lib/integrations/hikcentral-provider";
import { loadHikCentralRuntimeConfiguration } from "@/lib/integrations/hikcentral-configuration";
import type { RequestScope } from "@/lib/scope";
import { requireFacility } from "@/lib/scope";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";

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

export async function enrollBiometricAccess(scope: RequestScope, input: { facilityId: string; customerId: string; occupancyId: string; consent: boolean; image: File }) {
  if (!input.consent) throw new Error("BIOMETRIC_CONSENT_REQUIRED");
  validateFaceImage(input.image);
  await requireFacility(scope, input.facilityId);
  const occupancy = await db.occupancy.findFirst({
    where: { id: input.occupancyId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, tenancy: { facilityId: input.facilityId, customerId: input.customerId, customer: { organisationId: scope.organisationId } } },
    include: { tenancy: { include: { customer: true } } },
  });
  if (!occupancy) throw new Error("ACTIVE_OCCUPANCY_REQUIRED");
  const bytes = Buffer.from(await input.image.arrayBuffer());
  const imageDigest = createHash("sha256").update(bytes).digest("hex");
  const personCode = `ST24-${occupancy.tenancy.customerId}`;
  const enrollment = await db.biometricEnrollment.upsert({
    where: { occupancyId_purpose: { occupancyId: occupancy.id, purpose: "FACILITY_ACCESS" } },
    create: { organisationId: scope.organisationId, facilityId: input.facilityId, customerId: input.customerId, occupancyId: occupancy.id, consentPolicy: BIOMETRIC_CONSENT_POLICY, consentAt: new Date(), consentRecordedById: scope.userId, faceImageSha256: imageDigest, retentionUntil: occupancy.endDate },
    update: { status: "PENDING", consentPolicy: BIOMETRIC_CONSENT_POLICY, consentAt: new Date(), consentRecordedById: scope.userId, faceImageSha256: imageDigest, failureCode: null, failureMessage: null, revokedAt: null },
  });
  const customer = occupancy.tenancy.customer;
  const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId, input.facilityId));
  const result = await provider.enroll({ facilityId: input.facilityId, personCode, givenName: customer.firstName ?? customer.companyName ?? "Stor24", familyName: customer.lastName ?? "Customer", faceBase64: bytes.toString("base64"), validFrom: occupancy.startDate, validUntil: occupancy.endDate ?? undefined });
  if (!result.ok) {
    await db.$transaction([
      db.biometricEnrollment.update({ where: { id: enrollment.id }, data: { status: "FAILED", failureCode: result.code, failureMessage: result.message } }),
      db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "biometric.enrolment.failed", entityType: "BiometricEnrollment", entityId: enrollment.id, after: { code: result.code } } }),
    ]);
    throw new Error(result.code);
  }
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.biometricEnrollment.update({ where: { id: enrollment.id }, data: { status: "ACTIVE", externalPersonId: result.data.personId, externalPersonCode: result.data.personCode, providerReference: result.providerReference, provisionedAt: new Date(), failureCode: null, failureMessage: null } });
    await tx.occupancy.update({ where: { id: occupancy.id }, data: { accessState: "ACTIVE" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "biometric.enrolment.activated", entityType: "BiometricEnrollment", entityId: enrollment.id, after: { provider: "HIKCENTRAL", personCode } } });
    return updated;
  });
  if (customer.phone) {
    const details = await db.occupancy.findUnique({ where: { id: occupancy.id }, include: { unit: true, tenancy: { include: { facility: true } } } });
    if (details) await sendWhatsAppTemplate({ organisationId: scope.organisationId, facilityId: input.facilityId, customerId: input.customerId, recipient: customer.phone, consent: customer.communicationConsent, messageType: "ACCESS_READY", idempotencyKey: `access-ready:${enrollment.id}:WHATSAPP`, variables: { "1": customer.firstName || customer.companyName || "customer", "2": details.unit.number, "3": details.tenancy.facility.name } });
  }
  return updated;
}

export async function revokeBiometricAccess(scope: RequestScope, enrollmentId: string) {
  const enrollment = await db.biometricEnrollment.findFirst({ where: { id: enrollmentId, organisationId: scope.organisationId }, include: { occupancy: true } });
  if (!enrollment) throw new Error("NOT_FOUND");
  await requireFacility(scope, enrollment.facilityId);
  if (!enrollment.externalPersonId) throw new Error("BIOMETRIC_PERSON_NOT_PROVISIONED");
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
