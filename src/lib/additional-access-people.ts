import { db } from "@/lib/db";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { decryptPhoto, encryptPhoto, normaliseFacialPhoto } from "@/lib/facial-photo-security";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import type { Prisma } from "@/generated/prisma/client";
import { lockBooking, requireBookingEligible } from "@/lib/facial-photo-service";

type Tenant = { organisationId: string; email: string; customerIds: string[] };

async function booking(session: Tenant, reservationId: string) {
  const result = await db.reservation.findFirst({
    where: { id: reservationId, customer: tenantCustomerScope(session), facility: { organisationId: session.organisationId }, status: { in: ["ACTIVE", "CONVERTED"] }, OR: [{ convertedTenancyId: null }, { convertedTenancy: { status: { notIn: ["CLOSED", "CANCELLED"] } } }] },
    select: { id: true, facilityId: true, customerId: true },
  });
  if (!result) throw new Error("TENANT_NOT_FOUND");
  return result;
}

export async function listAdditionalAccessPeople(session: Tenant, reservationId: string) {
  await booking(session, reservationId);
  return db.additionalAccessPerson.findMany({
    where: { reservationId, status: { not: "REMOVED" } },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function nominateAdditionalAccessPerson(session: Tenant, reservationId: string, rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("PERSON_INVALID");
  return db.$transaction(async tx => {
    await lockBooking(tx, reservationId);
    const reservation = await tx.reservation.findFirst({
      where: { id: reservationId, customer: tenantCustomerScope(session), facility: { organisationId: session.organisationId }, status: { in: ["ACTIVE", "CONVERTED"] }, OR: [{ convertedTenancyId: null }, { convertedTenancy: { status: { notIn: ["CLOSED", "CANCELLED"] } } }] },
      select: { id: true, facilityId: true, customerId: true },
    });
    if (!reservation) throw new Error("TENANT_NOT_FOUND");
    if (await tx.additionalAccessPerson.count({ where: { reservationId, status: { not: "REMOVED" } } }) >= 20) throw new Error("PERSON_LIMIT");
    const person = await tx.additionalAccessPerson.create({ data: { reservationId, name }, select: { id: true, name: true, status: true } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: reservation.facilityId, action: "additional_access.nominated", entityType: "AdditionalAccessPerson", entityId: person.id, after: { reservationId, customerId: reservation.customerId } } });
    return person;
  });
}

export async function removeAdditionalAccessPerson(session: Tenant, reservationId: string, personId: string) {
  await db.$transaction(async tx => {
    await lockBooking(tx, reservationId);
    const reservation = await tx.reservation.findFirst({
      where: { id: reservationId, customer: tenantCustomerScope(session), facility: { organisationId: session.organisationId }, status: { in: ["ACTIVE", "CONVERTED"] } },
      select: { facilityId: true, customerId: true },
    });
    if (!reservation) throw new Error("TENANT_NOT_FOUND");
    const result = await tx.additionalAccessPerson.updateMany({ where: { id: personId, reservationId, status: { in: ["NOMINATED", "WAITING_REVIEW", "APPROVED", "REJECTED", "EXPIRED"] } }, data: { status: "REMOVED", encryptedImage: null, erasedAt: new Date(), reviewedAt: null, reviewedById: null } });
    if (result.count !== 1) throw new Error("NOT_FOUND");
    await tx.additionalPhotoHandoff.deleteMany({ where: { personId } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: reservation.facilityId, action: "additional_access.nomination_removed", entityType: "AdditionalAccessPerson", entityId: personId, after: { reservationId, customerId: reservation.customerId } } });
  });
}

const policySchema = z.object({
  enabled: z.literal(true),
  version: z.string().trim().min(1).max(100),
  notice: z.string().trim().min(40).max(12000),
  consentLabel: z.string().trim().min(15).max(1000),
  approvalReference: z.string().trim().min(1).max(300),
  retentionHours: z.number().int().min(1).max(2160),
});

export function additionalPersonPolicy(organisationId: string) {
  try {
    const policies = JSON.parse(process.env.ADDITIONAL_ACCESS_POLICIES_JSON ?? "{}");
    const policy = policySchema.safeParse(policies[organisationId]);
    if (!policy.success) return null;
    return { ...policy.data, hash: createHash("sha256").update(JSON.stringify(policy.data)).digest("hex") };
  } catch { return null; }
}

export async function listAdditionalPeopleForStaff(scope: RequestScope, reservationId?: string) {
  return db.additionalAccessPerson.findMany({
    where: { status: { not: "REMOVED" }, ...(reservationId ? { reservationId } : {}), reservation: { facility: facilityWhere(scope) } },
    select: { id: true, name: true, status: true, photoVersion: true, expiresAt: true, reservation: { select: { facilityId: true, facility: { select: { name: true } }, unit: { select: { number: true } } } } },
    orderBy: { createdAt: "asc" }, take: 200,
  });
}

async function requireAdditionalCollection(organisationId: string, database: Prisma.TransactionClient = db) {
  const policy = additionalPersonPolicy(organisationId);
  const maintenance = await database.facialPhotoMaintenance.findUnique({ where: { id: "expiry" } });
  if (!policy || !integrationEncryptionConfigured()) throw new Error("PHOTO_POLICY_PENDING");
  if (!maintenance || maintenance.completedAt.getTime() < Date.now() - 90 * 60_000) throw new Error("PHOTO_MAINTENANCE_REQUIRED");
  return policy;
}

export async function captureAdditionalPhoto(scope: RequestScope, input: { id: string; version: number; policyHash: string; consent: boolean; identityConfirmed: boolean; image: File }) {
  const policy = await requireAdditionalCollection(scope.organisationId);
  if (!input.consent || input.policyHash !== policy.hash) throw new Error("PHOTO_CONSENT_REQUIRED");
  if (!input.identityConfirmed) throw new Error("PHOTO_IDENTITY_REQUIRED");
  const bytes = await normaliseFacialPhoto(input.image);
  try {
    await db.$transaction(async tx => {
      await saveAdditionalPhoto(tx, scope, input, bytes, policy);
    });
  } finally { bytes.fill(0); }
}

async function saveAdditionalPhoto(tx: Prisma.TransactionClient, scope: RequestScope, input: { id: string; version: number; policyHash: string; consent: boolean; identityConfirmed: boolean }, bytes: Buffer, policy: NonNullable<ReturnType<typeof additionalPersonPolicy>>) {
  const candidate = await tx.additionalAccessPerson.findFirst({ where: { id: input.id, reservation: { facility: facilityWhere(scope) } }, select: { reservationId: true } });
  if (!candidate) throw new Error("NOT_FOUND");
  await lockBooking(tx, candidate.reservationId);
  const person = await tx.additionalAccessPerson.findFirst({ where: { id: input.id, reservation: { facility: facilityWhere(scope), status: { in: ["ACTIVE", "CONVERTED"] }, OR: [{ convertedTenancyId: null }, { convertedTenancy: { status: { notIn: ["CLOSED", "CANCELLED"] } } }] } }, include: { reservation: true } });
  if (!person || person.status === "REMOVED" || person.photoVersion !== input.version) throw new Error("PHOTO_CHANGED");
  const currentPolicy = await requireAdditionalCollection(scope.organisationId, tx);
  if (currentPolicy.hash !== input.policyHash || !input.consent) throw new Error("PHOTO_CONSENT_REQUIRED");
  if (!input.identityConfirmed) throw new Error("PHOTO_IDENTITY_REQUIRED");
  await requireBookingEligible(tx, scope.organisationId, candidate.reservationId);
  const version = person.photoVersion + 1, now = new Date();
  await tx.additionalAccessPerson.update({ where: { id: person.id }, data: {
    photoVersion: version, status: "WAITING_REVIEW",
    encryptedImage: encryptPhoto(bytes, `additional-person:${person.id}:photo:${version}`),
    imageSha256: createHash("sha256").update(bytes).digest("hex"), policyVersion: policy.version, policyHash: policy.hash,
    consentNotice: JSON.stringify(policy), consentAt: now, expiresAt: new Date(now.getTime() + policy.retentionHours * 3600000),
    reviewedAt: null, reviewedById: null, erasedAt: null,
  } });
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: person.reservation.facilityId, actorId: scope.userId, action: "additional_access.photo_captured", entityType: "AdditionalAccessPerson", entityId: person.id, after: { version, policyHash: policy.hash, policyVersion: policy.version, consentPolicy: policy, consentAt: now.toISOString(), identityConfirmedByStaff: true } } });
}

function handoffHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function issueAdditionalPhotoHandoff(scope: RequestScope, id: string, version: number, identityConfirmed: boolean) {
  if (!identityConfirmed) throw new Error("PHOTO_IDENTITY_REQUIRED");
  await requireAdditionalCollection(scope.organisationId);
  const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + 5 * 60_000);
  await db.$transaction(async tx => {
    const candidate = await tx.additionalAccessPerson.findFirst({ where: { id, reservation: { facility: facilityWhere(scope) } }, select: { reservationId: true } });
    if (!candidate) throw new Error("NOT_FOUND");
    await lockBooking(tx, candidate.reservationId);
    const person = await tx.additionalAccessPerson.findFirst({ where: { id, photoVersion: version, status: { in: ["NOMINATED", "REJECTED", "EXPIRED", "APPROVED"] }, reservation: { facility: facilityWhere(scope) } }, include: { reservation: true } });
    if (!person) throw new Error("PHOTO_CHANGED");
    await requireBookingEligible(tx, scope.organisationId, person.reservationId);
    await tx.additionalPhotoHandoff.deleteMany({ where: { personId: id, usedAt: null } });
    await tx.additionalPhotoHandoff.create({ data: { tokenHash: handoffHash(token), personId: id, photoVersion: version, issuedById: scope.userId, organisationId: scope.organisationId, facilityId: person.reservation.facilityId, expiresAt } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: person.reservation.facilityId, actorId: scope.userId, action: "additional_access.handoff_issued", entityType: "AdditionalAccessPerson", entityId: id, after: { version, expiresAt: expiresAt.toISOString(), identityConfirmedByStaff: true } } });
  });
  return { token, expiresAt };
}

export async function additionalPhotoHandoff(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("PHOTO_CHANGED");
  const handoff = await db.additionalPhotoHandoff.findUnique({ where: { tokenHash: handoffHash(token) } });
  if (!handoff || handoff.usedAt || handoff.expiresAt <= new Date()) throw new Error("PHOTO_CHANGED");
  const policy = await requireAdditionalCollection(handoff.organisationId);
  const person = await db.additionalAccessPerson.findFirst({ where: { id: handoff.personId, photoVersion: handoff.photoVersion, status: { in: ["NOMINATED", "REJECTED", "EXPIRED", "APPROVED"] }, reservation: { facilityId: handoff.facilityId, facility: { organisationId: handoff.organisationId } } }, select: { name: true, reservationId: true } });
  if (!person) throw new Error("PHOTO_CHANGED");
  await requireBookingEligible(db, handoff.organisationId, person.reservationId);
  return { name: person.name, notice: policy.notice, consentLabel: policy.consentLabel, retentionHours: policy.retentionHours, policyHash: policy.hash };
}

export async function captureAdditionalPhotoHandoff(token: string, input: { policyHash: string; consent: boolean; image: File }) {
  const view = await additionalPhotoHandoff(token);
  if (!input.consent || input.policyHash !== view.policyHash) throw new Error("PHOTO_CONSENT_REQUIRED");
  const bytes = await normaliseFacialPhoto(input.image);
  try {
    await db.$transaction(async tx => {
      const handoff = await tx.additionalPhotoHandoff.findUnique({ where: { tokenHash: handoffHash(token) } });
      if (!handoff) throw new Error("PHOTO_CHANGED");
      const person = await tx.additionalAccessPerson.findUnique({ where: { id: handoff.personId }, select: { reservationId: true } });
      if (!person) throw new Error("PHOTO_CHANGED");
      await lockBooking(tx, person.reservationId);
      await tx.$queryRaw`SELECT "id" FROM "AdditionalPhotoHandoff" WHERE "id" = ${handoff.id} FOR UPDATE`;
      const current = await tx.additionalPhotoHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
      if (current.usedAt || current.expiresAt <= new Date()) throw new Error("PHOTO_CHANGED");
      const policy = await requireAdditionalCollection(current.organisationId, tx);
      if (policy.hash !== input.policyHash) throw new Error("PHOTO_CONSENT_REQUIRED");
      const scope = { userId: current.issuedById, organisationId: current.organisationId, facilityIds: [current.facilityId], unrestrictedFacilities: false };
      await saveAdditionalPhoto(tx, scope, { id: current.personId, version: current.photoVersion, policyHash: input.policyHash, consent: true, identityConfirmed: true }, bytes, policy);
      await tx.additionalPhotoHandoff.update({ where: { id: current.id }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { organisationId: current.organisationId, facilityId: current.facilityId, actorId: current.issuedById, action: "additional_access.handoff_completed", entityType: "AdditionalAccessPerson", entityId: current.personId, after: { version: current.photoVersion + 1, customerConsent: true } } });
    });
  } finally { bytes.fill(0); }
}

export async function previewAdditionalPhoto(scope: RequestScope, id: string, version: number) {
  return db.$transaction(async tx => {
    const candidate = await tx.additionalAccessPerson.findFirst({ where: { id, reservation: { facility: facilityWhere(scope) } }, select: { reservationId: true } });
    if (!candidate) throw new Error("NOT_FOUND");
    await lockBooking(tx, candidate.reservationId);
    const person = await tx.additionalAccessPerson.findFirst({ where: { id, reservation: { facility: facilityWhere(scope), status: { in: ["ACTIVE", "CONVERTED"] }, OR: [{ convertedTenancyId: null }, { convertedTenancy: { status: { notIn: ["CLOSED", "CANCELLED"] } } }] } }, include: { reservation: true } });
    if (!person || person.status !== "WAITING_REVIEW" || person.photoVersion !== version || !person.encryptedImage || !person.expiresAt || person.expiresAt <= new Date() || additionalPersonPolicy(scope.organisationId)?.hash !== person.policyHash) throw new Error("PHOTO_CHANGED");
    await requireBookingEligible(tx, scope.organisationId, person.reservationId);
    const bytes = decryptPhoto(person.encryptedImage, `additional-person:${id}:photo:${version}`);
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: person.reservation.facilityId, actorId: scope.userId, action: "additional_access.photo_previewed", entityType: "AdditionalAccessPerson", entityId: id, after: { version } } });
    return bytes;
  });
}

export async function reviewAdditionalPhoto(scope: RequestScope, id: string, version: number, decision: "APPROVE" | "REJECT") {
  await db.$transaction(async tx => {
    const candidate = await tx.additionalAccessPerson.findFirst({ where: { id, reservation: { facility: facilityWhere(scope) } }, select: { reservationId: true } });
    if (!candidate) throw new Error("NOT_FOUND");
    await lockBooking(tx, candidate.reservationId);
    const person = await tx.additionalAccessPerson.findFirst({ where: { id, reservation: { facility: facilityWhere(scope), status: { in: ["ACTIVE", "CONVERTED"] }, OR: [{ convertedTenancyId: null }, { convertedTenancy: { status: { notIn: ["CLOSED", "CANCELLED"] } } }] } }, include: { reservation: true } });
    if (!person || person.status !== "WAITING_REVIEW" || person.photoVersion !== version || !person.encryptedImage || !person.expiresAt || person.expiresAt <= new Date() || additionalPersonPolicy(scope.organisationId)?.hash !== person.policyHash) throw new Error("PHOTO_CHANGED");
    await requireBookingEligible(tx, scope.organisationId, person.reservationId);
    if (decision === "APPROVE" && !await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, actorId: scope.userId, entityId: id, action: "additional_access.photo_previewed", after: { path: ["version"], equals: version } } })) throw new Error("PHOTO_PREVIEW_REQUIRED");
    await tx.additionalAccessPerson.update({ where: { id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedAt: new Date(), reviewedById: scope.userId, ...(decision === "REJECT" ? { encryptedImage: null, erasedAt: new Date() } : {}) } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: person.reservation.facilityId, actorId: scope.userId, action: `additional_access.photo_${decision.toLowerCase()}`, entityType: "AdditionalAccessPerson", entityId: id, after: { version, providerState: "NOT_CONNECTED" } } });
  });
}

export async function withdrawAdditionalPhoto(scope: RequestScope, id: string, version: number) {
  await db.$transaction(async tx => {
    const candidate = await tx.additionalAccessPerson.findFirst({ where: { id, reservation: { facility: facilityWhere(scope) } }, select: { reservationId: true } });
    if (!candidate) throw new Error("NOT_FOUND");
    await lockBooking(tx, candidate.reservationId);
    const person = await tx.additionalAccessPerson.findFirst({ where: { id, reservation: { facility: facilityWhere(scope) } }, include: { reservation: true } });
    if (!person || person.photoVersion !== version || !["WAITING_REVIEW", "APPROVED"].includes(person.status)) throw new Error("PHOTO_CHANGED");
    await tx.additionalAccessPerson.update({ where: { id }, data: { status: "NOMINATED", encryptedImage: null, erasedAt: new Date(), reviewedAt: null, reviewedById: null } });
    await tx.additionalPhotoHandoff.deleteMany({ where: { personId: id } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: person.reservation.facilityId, actorId: scope.userId, action: "additional_access.photo_withdrawn", entityType: "AdditionalAccessPerson", entityId: id, after: { version, providerState: "NOT_CONNECTED" } } });
  });
}
