import { resolvedPhotoPolicy } from "@/lib/facial-photo-control";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { reservationReadiness } from "@/lib/reservation-move-in";
import { decryptPhoto, encryptPhoto, normaliseFacialPhoto } from "@/lib/facial-photo-security";
import { integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import { requestPhotoActivation } from "@/lib/facial-photo-activation";

type Database = Prisma.TransactionClient;
type Tenant = { organisationId: string; email: string; customerIds: string[] };
const liveStatuses = ["WAITING_REVIEW", "APPROVED", "PENDING_PROVIDER"];
export const photoSummary = { id: true, reservationId: true, version: true, status: true, consentAt: true, expiresAt: true, reviewedAt: true, activationRequestedAt: true, erasedAt: true } as const;
const binding = (reservationId: string, version: number) => `reservation:${reservationId}:photo:${version}`;

async function tenantBooking(database: Database, session: Tenant, reservationId: string) {
  const reservation = await database.reservation.findFirst({ where: { id: reservationId, customer: tenantCustomerScope(session), facility: { organisationId: session.organisationId } } });
  if (!reservation) throw new Error("TENANT_NOT_FOUND");
  return reservation;
}
async function lockBooking(database: Database, id: string) {
  await database.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} FOR UPDATE`;
  const accountNumber = `ST24-T-${id}`;
  await database.$queryRaw`SELECT "id" FROM "Account" WHERE "accountNumber" = ${accountNumber} FOR UPDATE`;
}
async function readyToCollect(database: Database, organisationId: string) {
  const policy = await resolvedPhotoPolicy(database, organisationId);
  if (!policy?.enabled || !integrationEncryptionConfigured()) throw new Error("PHOTO_POLICY_PENDING");
  const maintenance = await database.facialPhotoMaintenance.findUnique({ where: { id: "expiry" } });
  if (!maintenance || maintenance.completedAt.getTime() < Date.now() - 90 * 60 * 1000) throw new Error("PHOTO_MAINTENANCE_REQUIRED");
  return policy;
}
async function requireBookingEligible(database: Database, organisationId: string, reservationId: string) {
  const state = await reservationReadiness(database, { userId: "customer-photo", organisationId, facilityIds: [], unrestrictedFacilities: true }, reservationId, true);
  if (!state.view.ready) throw new Error("PHOTO_BOOKING_NOT_READY");
  const lease = await database.publicReservationLease.findUnique({ where: { reservationId } });
  if (!lease?.signedPdf || createHash("sha256").update(lease.signedPdf).digest("hex") !== lease.signedPdfSha256 || createHash("sha256").update(lease.content).digest("hex") !== lease.sha256) throw new Error("PHOTO_BOOKING_NOT_READY");
}

export async function tenantPhotoStatus(session: Tenant, reservationId: string) {
  await tenantBooking(db, session, reservationId);
  let available = false;
  const policy = await resolvedPhotoPolicy(db, session.organisationId);
  try { await readyToCollect(db, session.organisationId); await requireBookingEligible(db, session.organisationId, reservationId); available = true; } catch { /* Read-only status is still available during policy/provider holds. */ }
  const photo = await db.facialPhotoSubmission.findUnique({ where: { reservationId }, select: photoSummary });
  return { available, policy: policy ? { version: policy.version, hash: policy.hash, notice: policy.notice, consentLabel: policy.consentLabel, retentionHours: policy.retentionHours, alternativeContact: policy.alternativeContact } : null,
    photo: photo ? { ...photo, status: (photo.expiresAt !== null && photo.expiresAt <= new Date()) && liveStatuses.includes(photo.status) ? "EXPIRED" : photo.status } : null };
}

export async function submitTenantPhoto(session: Tenant, input: { reservationId: string; policyHash: string; consent: boolean; expectedVersion: number; image: File }) {
  await tenantBooking(db, session, input.reservationId);
  const policy = await readyToCollect(db, session.organisationId);
  if (!input.consent || policy.hash !== input.policyHash) throw new Error("PHOTO_CONSENT_REQUIRED");
  await requireBookingEligible(db, session.organisationId, input.reservationId);
  const bytes = await normaliseFacialPhoto(input.image);
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${session.organisationId} FOR UPDATE`;
      await lockBooking(tx, input.reservationId);
      const reservation = await tenantBooking(tx, session, input.reservationId);
      const currentPolicy = await readyToCollect(tx, session.organisationId);
      if (currentPolicy.hash !== input.policyHash) throw new Error("PHOTO_CONSENT_REQUIRED");
      await requireBookingEligible(tx, session.organisationId, input.reservationId);
      const current = await tx.facialPhotoSubmission.findUnique({ where: { reservationId: reservation.id } });
      if ((current?.version ?? 0) !== input.expectedVersion) throw new Error("PHOTO_CHANGED");
      const version = (current?.version ?? 0) + 1, now = new Date();
      const values = { version, status: "WAITING_REVIEW", encryptedImage: encryptPhoto(bytes, binding(reservation.id, version)), imageSha256: createHash("sha256").update(bytes).digest("hex"), policyVersion: currentPolicy.version, policyHash: currentPolicy.hash, consentNotice: JSON.stringify({ notice: currentPolicy.notice, consentLabel: currentPolicy.consentLabel, alternativeContact: currentPolicy.alternativeContact, retentionHours: currentPolicy.retentionHours, approvalReference: currentPolicy.approvalReference }), consentAt: now, expiresAt: currentPolicy.retentionHours === null ? null : new Date(now.getTime() + currentPolicy.retentionHours * 3600000), reviewedAt: null, reviewedById: null, activationRequestedAt: null, occupancyId: null, erasedAt: null };
      const photo = await tx.facialPhotoSubmission.upsert({ where: { reservationId: reservation.id }, create: { reservationId: reservation.id, ...values }, update: values, select: photoSummary });
      await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: reservation.facilityId, action: "facial_photo.customer_submitted", entityType: "FacialPhotoSubmission", entityId: photo.id, after: { customerId: reservation.customerId, version, policyHash: currentPolicy.hash, policyVersion: currentPolicy.version, approvalReference: currentPolicy.approvalReference, collectionPolicy: currentPolicy, consentAt: now.toISOString(), expiresAt: values.expiresAt?.toISOString() ?? null, replacedVersion: current?.version ?? null } } });
      return photo;
    });
  } finally { bytes.fill(0); }
}

export async function withdrawTenantPhoto(session: Tenant, reservationId: string, version: number) {
  return db.$transaction(async tx => {
    await tenantBooking(tx, session, reservationId);
    await lockBooking(tx, reservationId);
    const reservation = await tenantBooking(tx, session, reservationId);
    const photo = await tx.facialPhotoSubmission.findUnique({ where: { reservationId } });
    if (!photo || photo.version !== version) throw new Error("PHOTO_CHANGED");
    if (photo.status === "WITHDRAWN") return;
    // No provider consumer is enabled in this release; pending activation is cancelled here.
    await tx.facialPhotoSubmission.update({ where: { id: photo.id }, data: { status: "WITHDRAWN", encryptedImage: null, erasedAt: new Date(), activationRequestedAt: null, reviewedAt: null, reviewedById: null } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: reservation.facilityId, action: "facial_photo.consent_withdrawn", entityType: "FacialPhotoSubmission", entityId: photo.id, after: { customerId: reservation.customerId, version } } });
  });
}

export async function listFacialPhotos(scope: RequestScope, reservationId?: string) {
  return db.facialPhotoSubmission.findMany({ where: { ...(reservationId ? { reservationId } : {}), reservation: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } } },
    select: { ...photoSummary, reservation: { select: { status: true, facilityId: true, customer: { select: { firstName: true, lastName: true, companyName: true } }, unit: { select: { number: true } }, facility: { select: { name: true } } } } }, orderBy: { updatedAt: "desc" }, take: 200 });
}
async function staffPhoto(database: Database, scope: RequestScope, id: string) {
  const photo = await database.facialPhotoSubmission.findFirst({ where: { id, reservation: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } } }, include: { reservation: true } });
  if (!photo) throw new Error("NOT_FOUND");
  return photo;
}
export async function previewFacialPhoto(scope: RequestScope, id: string, version: number) {
  return db.$transaction(async tx => {
    const candidate = await staffPhoto(tx, scope, id);
    await lockBooking(tx, candidate.reservationId);
    const photo = await staffPhoto(tx, scope, id);
    if (photo.version !== version || !photo.encryptedImage || (photo.expiresAt !== null && photo.expiresAt <= new Date()) || !liveStatuses.includes(photo.status) || (await resolvedPhotoPolicy(tx, scope.organisationId))?.hash !== photo.policyHash || !["ACTIVE", "CONVERTED"].includes(photo.reservation.status)) throw new Error("PHOTO_CHANGED");
    await requireBookingEligible(tx, scope.organisationId, photo.reservationId);
    const bytes = decryptPhoto(photo.encryptedImage, binding(photo.reservationId, photo.version));
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: photo.reservation.facilityId, actorId: scope.userId, action: "facial_photo.previewed", entityType: "FacialPhotoSubmission", entityId: id, after: { version } } });
    return bytes;
  });
}
export async function reviewFacialPhoto(scope: RequestScope, id: string, version: number, decision: "APPROVE" | "REJECT") {
  return db.$transaction(async tx => {
    const candidate = await staffPhoto(tx, scope, id);
    await lockBooking(tx, candidate.reservationId);
    const photo = await staffPhoto(tx, scope, id);
    if (photo.version !== version || photo.status !== "WAITING_REVIEW" || !photo.encryptedImage || (photo.expiresAt !== null && photo.expiresAt <= new Date())) throw new Error("PHOTO_CHANGED");
    if (decision === "APPROVE") {
      const policy = await resolvedPhotoPolicy(tx, scope.organisationId);
      if (!policy || policy.hash !== photo.policyHash) throw new Error("PHOTO_CONSENT_REQUIRED");
      await requireBookingEligible(tx, scope.organisationId, photo.reservationId);
      const previewed = await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, actorId: scope.userId, entityId: id, action: "facial_photo.previewed", after: { path: ["version"], equals: version } } });
      if (!previewed) throw new Error("PHOTO_PREVIEW_REQUIRED");
    }
    await tx.facialPhotoSubmission.update({ where: { id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: scope.userId, reviewedAt: new Date(), ...(decision === "REJECT" ? { encryptedImage: null, erasedAt: new Date() } : {}) } });
    if (decision === "APPROVE" && photo.reservation.convertedTenancyId) {
      const occupancy = await tx.occupancy.findFirst({ where: { tenancyId: photo.reservation.convertedTenancyId, unitId: photo.reservation.unitId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } });
      if (!occupancy) throw new Error("PHOTO_BOOKING_NOT_READY");
      await requestPhotoActivation(tx, scope, photo.reservationId, occupancy.id);
    }
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: photo.reservation.facilityId, actorId: scope.userId, action: decision === "APPROVE" ? "facial_photo.approved_for_handover" : "facial_photo.rejected", entityType: "FacialPhotoSubmission", entityId: id, after: { version } } });
  });
}

/** Scheduled deletion also runs with collection disabled. Deletes ciphertext, not just a date. */
export async function expireFacialPhotos() {
  const where: Prisma.FacialPhotoSubmissionWhereInput = { encryptedImage: { not: null }, OR: [
    { expiresAt: { lte: new Date() } },
    { reservation: { status: { in: ["CANCELLED", "EXPIRED"] } } },
    { reservation: { convertedTenancy: { status: { in: ["CLOSED", "CANCELLED"] } } } },
    { occupancy: { status: { in: ["MOVED_OUT", "CANCELLED"] } } },
  ] };
  let expired = 0;
  // Bounded batches. The worker retries while there are more expired records;
  // its heartbeat is written only after the complete due set is removed.
  const candidates = await db.facialPhotoSubmission.findMany({ where, select: { id: true, reservationId: true }, take: 100 });
  for (const candidate of candidates) await db.$transaction(async tx => {
    await lockBooking(tx, candidate.reservationId);
    const photo = await tx.facialPhotoSubmission.findFirst({ where: { ...where, id: candidate.id }, include: { reservation: { include: { facility: { select: { organisationId: true } } } } } });
    if (!photo) return;
    await tx.facialPhotoSubmission.update({ where: { id: photo.id }, data: { encryptedImage: null, erasedAt: new Date(), status: "EXPIRED", activationRequestedAt: null, reviewedAt: null, reviewedById: null } });
    await tx.auditEvent.create({ data: { organisationId: photo.reservation.facility.organisationId, facilityId: photo.reservation.facilityId, action: "facial_photo.erased", entityType: "FacialPhotoSubmission", entityId: photo.id, after: { version: photo.version, reason: "RETENTION_OR_BOOKING_ENDED" } } });
    expired++;
  });
  if (await db.facialPhotoSubmission.count({ where }) > 0) throw new Error("PHOTO_EXPIRY_MORE_DUE");
  await db.facialPhotoMaintenance.upsert({ where: { id: "expiry" }, create: { id: "expiry", completedAt: new Date() }, update: { completedAt: new Date() } });
  return expired;
}
