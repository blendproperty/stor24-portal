import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { HikCentralAccessProvider } from "@/lib/integrations/hikcentral-provider";
import { loadHikCentralRuntimeConfiguration } from "@/lib/integrations/hikcentral-configuration";
import type { RequestScope } from "@/lib/scope";
import { requireFacility } from "@/lib/scope";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";

// STOR24 "Option 1" self-service facial access. Mark Corbishley selected this
// option on 16 September 2026 (see the mailed
// STOR24_Access_Options_For_Mark.pdf and the accompanying implementation
// handover). A verified, agreement-signed, paid public customer submits a
// consented facial photo bound to their Reservation; no HikCentral call
// happens until an authorised staff member separately approves it, and only
// once the resulting occupancy is ACTIVE. This deliberately gates on
// occupancy ACTIVE rather than the Move In click alone, because moveIn()
// in leasing-service.ts does not itself activate the tenancy -- activation
// only happens later once the lease is actually signed. Gating on ACTIVE is
// therefore the stricter, safer reading of "only after staff clicks Move In
// may the tenancy activate and the photo be submitted to HikCentral".
export const FACIAL_SUBMISSION_CONSENT_POLICY = "stor24-self-service-facial-access-v1";
export const MAX_FACIAL_SUBMISSION_BYTES = 5 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png"]);

export function validateFacialSubmissionImage(file: File) {
  if (!allowedImageTypes.has(file.type)) throw new Error("FACE_IMAGE_TYPE_INVALID");
  if (file.size < 1 || file.size > MAX_FACIAL_SUBMISSION_BYTES) throw new Error("FACE_IMAGE_SIZE_INVALID");
}

// Only CARD/EFT reservations paid through the existing, live Netcash Pay Now
// path (see public-netcash-payment.ts, which resolves the reservation-bound
// `ST24-T-<reservationId>` account) count as a cleared, qualifying payment
// today. DEBIT_ORDER reservations have no automated "payment cleared" signal
// yet -- PROJECT_CONTEXT.md records debit-order collection as not yet
// implemented, only a staff follow-up task. Qualifying-payment rules for that
// method are an explicit open owner decision (2026-09-16 handover, section
// 12), not something to invent here. Staff can still enrol a debit-order
// tenant manually through the existing /access workspace after independently
// confirming payment through their own process.
async function findQualifyingPayment(reservationId: string) {
  const account = await db.account.findUnique({
    where: { accountNumber: `ST24-T-${reservationId}` },
    select: { payments: { where: { provider: "NETCASH", method: "PAY_NOW", status: "SUCCEEDED" }, select: { id: true }, take: 1 } },
  });
  return account?.payments[0] ?? null;
}

export async function facialAccessEligibility(publicReference: string) {
  const reservation = await db.reservation.findUnique({
    where: { publicReference },
    include: { customer: true, publicLease: true },
  });
  if (!reservation || reservation.status !== "ACTIVE" || reservation.journey !== "RENTAL") {
    return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };
  }
  if (!reservation.contactVerifiedAt || !reservation.customer.emailVerifiedAt) {
    return { ok: false as const, code: "VERIFICATION_REQUIRED" };
  }
  if (reservation.publicLease?.status !== "SIGNED") {
    return { ok: false as const, code: "AGREEMENT_NOT_SIGNED" };
  }
  if (reservation.publicLease.paymentMethod === "DEBIT_ORDER") {
    return { ok: false as const, code: "DEBIT_ORDER_NOT_YET_SUPPORTED" };
  }
  const payment = await findQualifyingPayment(reservation.id);
  if (!payment) return { ok: false as const, code: "PAYMENT_NOT_CLEARED" };
  return { ok: true as const, reservation };
}

export async function submitFacialPhoto(publicReference: string, input: { image: File; consent: boolean; ipHash?: string }) {
  if (!input.consent) throw new Error("FACIAL_CONSENT_REQUIRED");
  validateFacialSubmissionImage(input.image);
  const eligibility = await facialAccessEligibility(publicReference);
  if (!eligibility.ok) throw new Error(eligibility.code);
  const reservation = eligibility.reservation;
  const bytes = Buffer.from(await input.image.arrayBuffer());
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  await db.$transaction(async (tx) => {
    await tx.facialPhotoSubmission.updateMany({
      where: { reservationId: reservation.id, status: "AWAITING_STAFF" },
      data: { status: "SUPERSEDED" },
    });
    await tx.facialPhotoSubmission.create({
      data: {
        organisationId: reservation.customer.organisationId,
        facilityId: reservation.facilityId,
        reservationId: reservation.id,
        customerId: reservation.customerId,
        imageData: bytes,
        imageSha256,
        imageMimeType: input.image.type,
        consentPolicyVersion: FACIAL_SUBMISSION_CONSENT_POLICY,
        consentAt: new Date(),
        submitterIpHash: input.ipHash ?? null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organisationId: reservation.customer.organisationId,
        facilityId: reservation.facilityId,
        action: "facial_access.photo_submitted",
        entityType: "Reservation",
        entityId: reservation.id,
      },
    });
  });
  return { ok: true as const, status: "AWAITING_STAFF" as const };
}

export async function getFacialSubmissionStatus(publicReference: string) {
  const reservation = await db.reservation.findUnique({
    where: { publicReference },
    select: {
      id: true,
      facialPhotoSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, rejectionReason: true, createdAt: true, reviewedAt: true },
      },
    },
  });
  if (!reservation) return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };
  const submission = reservation.facialPhotoSubmissions[0];
  if (!submission) return { ok: true as const, status: "PHOTO_REQUIRED" as const, rejectionReason: null, submittedAt: null, reviewedAt: null };
  return {
    ok: true as const,
    status: submission.status,
    rejectionReason: submission.rejectionReason,
    submittedAt: submission.createdAt.toISOString(),
    reviewedAt: submission.reviewedAt?.toISOString() ?? null,
  };
}

export async function listPendingFacialSubmissions(scope: RequestScope) {
  return db.facialPhotoSubmission.findMany({
    where: {
      status: "AWAITING_STAFF",
      organisationId: scope.organisationId,
      ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }),
    },
    include: {
      customer: true,
      facility: true,
      reservation: { include: { unit: true, publicLease: true, convertedTenancy: { include: { occupancies: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function rejectFacialSubmission(scope: RequestScope, submissionId: string, reason: string) {
  const submission = await db.facialPhotoSubmission.findFirst({ where: { id: submissionId, organisationId: scope.organisationId, status: "AWAITING_STAFF" } });
  if (!submission) throw new Error("NOT_FOUND");
  await requireFacility(scope, submission.facilityId);
  return db.$transaction(async (tx) => {
    const updated = await tx.facialPhotoSubmission.update({
      where: { id: submission.id },
      data: { status: "REJECTED", reviewedById: scope.userId, reviewedAt: new Date(), rejectionReason: reason },
    });
    await tx.auditEvent.create({
      data: { organisationId: scope.organisationId, facilityId: submission.facilityId, actorId: scope.userId, action: "facial_access.photo_rejected", entityType: "FacialPhotoSubmission", entityId: submission.id, after: { reason } },
    });
    return updated;
  });
}

export async function approveFacialSubmission(scope: RequestScope, submissionId: string) {
  const submission = await db.facialPhotoSubmission.findFirst({
    where: { id: submissionId, organisationId: scope.organisationId, status: "AWAITING_STAFF" },
    include: {
      customer: true,
      reservation: { include: { convertedTenancy: { include: { occupancies: { include: { unit: true, tenancy: { include: { facility: true } } } } } } } },
    },
  });
  if (!submission) throw new Error("NOT_FOUND");
  await requireFacility(scope, submission.facilityId);

  const occupancy = submission.reservation.convertedTenancy?.occupancies.find((item) => item.status === "ACTIVE");
  if (!occupancy) throw new Error("OCCUPANCY_NOT_ACTIVE");

  // Recheck payment at approval time too, not just at submission time -- the
  // handover explicitly calls for staff activation to re-verify this
  // server-side rather than trust the earlier submission-time check alone.
  const payment = await findQualifyingPayment(submission.reservationId);
  if (!payment) throw new Error("PAYMENT_NOT_CLEARED");

  const personCode = `ST24-${submission.customerId}`;
  const enrollment = await db.biometricEnrollment.upsert({
    where: { occupancyId_purpose: { occupancyId: occupancy.id, purpose: "FACILITY_ACCESS" } },
    create: {
      organisationId: scope.organisationId,
      facilityId: submission.facilityId,
      customerId: submission.customerId,
      occupancyId: occupancy.id,
      // Consent belongs to the customer who submitted the photo, not the
      // reviewing staff member -- consentRecordedById is deliberately left
      // unset here, unlike the pre-existing staff-attested enrolment path in
      // biometric-access-service.ts.
      consentPolicy: submission.consentPolicyVersion,
      consentAt: submission.consentAt,
      faceImageSha256: submission.imageSha256,
      retentionUntil: occupancy.endDate,
    },
    update: {
      status: "PENDING",
      consentPolicy: submission.consentPolicyVersion,
      consentAt: submission.consentAt,
      faceImageSha256: submission.imageSha256,
      failureCode: null,
      failureMessage: null,
      revokedAt: null,
    },
  });

  const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId, submission.facilityId));
  const result = await provider.enroll({
    facilityId: submission.facilityId,
    personCode,
    givenName: submission.customer.firstName ?? submission.customer.companyName ?? "Stor24",
    familyName: submission.customer.lastName ?? "Customer",
    faceBase64: submission.imageData.toString("base64"),
    validFrom: occupancy.startDate,
    validUntil: occupancy.endDate ?? undefined,
  });

  if (!result.ok) {
    await db.$transaction([
      db.biometricEnrollment.update({ where: { id: enrollment.id }, data: { status: "FAILED", failureCode: result.code, failureMessage: result.message } }),
      db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: submission.facilityId, actorId: scope.userId, action: "facial_access.enrolment_failed", entityType: "BiometricEnrollment", entityId: enrollment.id, after: { code: result.code, submissionId: submission.id } } }),
    ]);
    // The submission itself is left AWAITING_STAFF (not REJECTED) so staff
    // can retry once the underlying HikCentral/configuration issue is fixed,
    // rather than forcing the customer to resubmit a fresh photo for a
    // provider-side failure that had nothing to do with the photo itself.
    throw new Error(result.code);
  }

  const updated = await db.$transaction(async (tx) => {
    const updatedEnrollment = await tx.biometricEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "ACTIVE", externalPersonId: result.data.personId, externalPersonCode: result.data.personCode, providerReference: result.providerReference, provisionedAt: new Date(), failureCode: null, failureMessage: null },
    });
    await tx.occupancy.update({ where: { id: occupancy.id }, data: { accessState: "ACTIVE" } });
    await tx.facialPhotoSubmission.update({
      where: { id: submission.id },
      data: { status: "APPROVED", reviewedById: scope.userId, reviewedAt: new Date(), enrollmentId: updatedEnrollment.id },
    });
    await tx.auditEvent.create({
      data: { organisationId: scope.organisationId, facilityId: submission.facilityId, actorId: scope.userId, action: "facial_access.enrolment_activated", entityType: "BiometricEnrollment", entityId: updatedEnrollment.id, after: { provider: "HIKCENTRAL", personCode, submissionId: submission.id } },
    });
    return updatedEnrollment;
  });

  if (submission.customer.phone) {
    await sendWhatsAppTemplate({
      organisationId: scope.organisationId,
      facilityId: submission.facilityId,
      customerId: submission.customerId,
      recipient: submission.customer.phone,
      consent: submission.customer.communicationConsent,
      messageType: "ACCESS_READY",
      idempotencyKey: `access-ready:${updated.id}:WHATSAPP`,
      variables: { "1": submission.customer.firstName || submission.customer.companyName || "customer", "2": occupancy.unit.number, "3": occupancy.tenancy.facility.name },
    });
  }
  return updated;
}
