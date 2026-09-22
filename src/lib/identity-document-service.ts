import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import { decryptIdentity, encryptIdentity, identityAccessMatches, identityPolicy, identityRequired, normaliseIdentityPage } from "@/lib/identity-document-security";

type Database = Prisma.TransactionClient;
export const identitySummary = { id: true, reservationId: true, version: true, status: true, documentType: true, pageCount: true, acknowledgedAt: true, retentionMode: true, expiresAt: true, reviewedAt: true, erasedAt: true, replacementReason: true } as const;
const binding = (id: string, version: number) => `reservation:${id}:identity:${version}`;
const pending = ["AWAITING_REVIEW", "ACCEPTED"];
function copyWithinRetention(document: { retentionMode: string; expiresAt: Date | null }) {
  return document.retentionMode === "TENANCY" ? document.expiresAt === null : Boolean(document.expiresAt && document.expiresAt > new Date());
}
async function lock(database: Database, id: string) {
  await database.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} FOR UPDATE`;
}
async function publicBooking(database: Database, reference: string, token: string) {
  const booking = await database.reservation.findUnique({ where: { publicReference: reference }, include: { customer: true, publicLease: { select: { status: true } } } });
  if (!booking || !identityAccessMatches(token, booking.identityAccessHash, booking.identityAccessExpiresAt)) throw new Error("ID_SESSION_REQUIRED");
  if (booking.status !== "ACTIVE" || booking.journey !== "RENTAL" || !booking.contactVerifiedAt || !booking.customer.emailVerifiedAt || (booking.publicLease?.status !== "SIGNED" && (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()))) throw new Error("ID_BOOKING_UNAVAILABLE");
  return booking;
}
async function collectionReady(database: Database) {
  if (!integrationEncryptionConfigured()) throw new Error("ID_POLICY_UNAVAILABLE");
  const worker = await database.identityDocumentMaintenance.findUnique({ where: { id: "expiry" } });
  if (!worker || worker.completedAt.getTime() < Date.now() - 90 * 60 * 1000) throw new Error("ID_MAINTENANCE_REQUIRED");
}
export async function identityStatus(reference: string, token: string) {
  const booking = await publicBooking(db, reference, token);
  const policy = identityRequired(booking.customer.organisationId, booking.createdAt, booking.id, booking.customer.email);
  const document = await db.identityDocument.findUnique({ where: { reservationId: booking.id }, select: { ...identitySummary, policyHash: true } });
  let available = false;
  if (policy) { try { await collectionReady(db); available = true; } catch { /* Fail closed for new uploads, retain readable status. */ } }
  const valid = document && policy && document.policyHash === policy.hash && (document.status === "ACCEPTED" || (document.status === "AWAITING_REVIEW" && copyWithinRetention(document)));
  const lease = await db.publicReservationLease.findUnique({ where: { reservationId: booking.id }, select: { signingToken: true } });
  return { agreementToken: lease?.signingToken ?? null, required: Boolean(policy), available, canContinue: !policy || Boolean(valid),
    policy: policy ? { hash: policy.hash, notice: policy.notice, acknowledgementLabel: policy.acknowledgementLabel, acceptedTypes: policy.acceptedTypes, alternativeContact: policy.alternativeContact } : null,
    document: document ? { ...document, status: document.status === "AWAITING_REVIEW" && !copyWithinRetention(document) ? "EXPIRED" : document.status } : null };
}
export async function submitIdentity(reference: string, token: string, input: { expectedVersion: number; policyHash: string; acknowledged: boolean; documentType: string; pages: File[] }) {
  const booking = await publicBooking(db, reference, token);
  const policy = identityRequired(booking.customer.organisationId, booking.createdAt, booking.id, booking.customer.email);
  if (!policy) throw new Error("ID_POLICY_UNAVAILABLE");
  if (!input.acknowledged || policy.hash !== input.policyHash) throw new Error("ID_NOTICE_REQUIRED");
  if (!policy.acceptedTypes.some(type => type === input.documentType) || input.pages.length !== (input.documentType === "ID_CARD" ? 2 : 1)) throw new Error("ID_INVALID");
  await collectionReady(db);
  const pages: Buffer[] = []; let payload: Buffer | undefined;
  try {
    for (const page of input.pages) pages.push(await normaliseIdentityPage(page));
    payload = Buffer.from(JSON.stringify(pages.map(page => page.toString("base64"))));
    return await db.$transaction(async tx => {
      await lock(tx, booking.id);
      const currentBooking = await publicBooking(tx, reference, token);
      const currentPolicy = identityRequired(currentBooking.customer.organisationId, currentBooking.createdAt, currentBooking.id, currentBooking.customer.email);
      if (!currentPolicy || currentPolicy.hash !== input.policyHash) throw new Error("ID_NOTICE_REQUIRED");
      await collectionReady(tx);
      const previous = await tx.identityDocument.findUnique({ where: { reservationId: booking.id } });
      if ((previous?.version ?? 0) !== input.expectedVersion) throw new Error("ID_CHANGED");
      const version = (previous?.version ?? 0) + 1, now = new Date();
      const values = { version, status: "AWAITING_REVIEW", documentType: input.documentType, pageCount: pages.length,
        encryptedPages: encryptIdentity(payload!, binding(booking.id, version)), policyHash: currentPolicy.hash, policySnapshot: JSON.stringify(currentPolicy),
        acknowledgedAt: now, retentionMode: currentPolicy.retentionMode ?? "FIXED_PERIOD", expiresAt: currentPolicy.retentionMode === "TENANCY" ? null : new Date(now.getTime() + currentPolicy.retentionHours! * 3600000), reviewedAt: null, reviewedById: null, erasedAt: null, replacementReason: null };
      const document = await tx.identityDocument.upsert({ where: { reservationId: booking.id }, create: { reservationId: booking.id, ...values }, update: values, select: identitySummary });
      await tx.auditEvent.create({ data: { organisationId: booking.customer.organisationId, facilityId: booking.facilityId, action: "identity_document.submitted", entityType: "IdentityDocument", entityId: document.id, after: { version, approvedPolicy: currentPolicy, expiresAt: values.expiresAt?.toISOString() ?? null } } });
      return document;
    });
  } finally { pages.forEach(page => page.fill(0)); payload?.fill(0); }
}
export async function withdrawIdentity(reference: string, token: string, version: number) {
  const booking = await publicBooking(db, reference, token);
  await db.$transaction(async tx => {
    await lock(tx, booking.id); await publicBooking(tx, reference, token);
    const document = await tx.identityDocument.findUnique({ where: { reservationId: booking.id } });
    if (!document || document.version !== version) throw new Error("ID_CHANGED");
    await tx.identityDocument.update({ where: { id: document.id }, data: { status: "WITHDRAWN", encryptedPages: null, erasedAt: new Date(), reviewedAt: null, reviewedById: null } });
    await tx.auditEvent.create({ data: { organisationId: booking.customer.organisationId, facilityId: booking.facilityId, action: "identity_document.withdrawn", entityType: "IdentityDocument", entityId: document.id, after: { version } } });
  });
}
export async function identityGate(database: Database, organisationId: string, reservationId: string, createdAt: Date, stage: "SIGN" | "HANDOVER") {
  if (!identityPolicy(organisationId)) return true;
  const booking = await database.reservation.findUnique({ where: { id: reservationId }, select: { publicReference: true, customer: { select: { email: true } } } });
  const policy = identityRequired(organisationId, createdAt, reservationId, booking?.customer.email);
  if (!policy) return true;
  if (!booking?.publicReference) return true; // This policy applies to online bookings; assisted intake is a separate workflow.
  const document = await database.identityDocument.findUnique({ where: { reservationId } });
  return Boolean(document && document.policyHash === policy.hash && (document.status === "ACCEPTED" || (stage === "SIGN" && document.status === "AWAITING_REVIEW" && document.encryptedPages && copyWithinRetention(document))));
}
export async function listIdentityDocuments(scope: RequestScope) {
  return db.identityDocument.findMany({ where: { reservation: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } } }, select: { ...identitySummary, reservation: { select: { status: true, facilityId: true, publicReference: true, facility: { select: { name: true } }, unit: { select: { number: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } } } } }, orderBy: { acknowledgedAt: "desc" }, take: 200 });
}
async function scopedDocument(database: Database, scope: RequestScope, id: string, version: number) {
  const initial = await database.identityDocument.findFirst({ where: { id, reservation: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } } }, select: { reservationId: true } });
  if (!initial) throw new Error("NOT_FOUND");
  await lock(database, initial.reservationId);
  const document = await database.identityDocument.findUniqueOrThrow({ where: { id }, include: { reservation: { include: { customer: { select: { email: true } }, convertedTenancy: { select: { status: true, customerId: true, facilityId: true } } } } } });
  const policy = identityRequired(scope.organisationId, document.reservation.createdAt, document.reservationId, document.reservation.customer.email);
  const tenancy = document.reservation.convertedTenancy;
  const retainedTenancy = document.retentionMode === "TENANCY" && document.reservation.status === "CONVERTED" && tenancy && ["ACTIVE", "NOTICE_GIVEN"].includes(tenancy.status) && tenancy.customerId === document.reservation.customerId && tenancy.facilityId === document.reservation.facilityId;
  if (document.version !== version || !pending.includes(document.status) || !copyWithinRetention(document) || !document.encryptedPages || (document.reservation.status !== "ACTIVE" && !retainedTenancy) || !policy || policy.hash !== document.policyHash) throw new Error("ID_CHANGED");
  return document;
}
export async function previewIdentity(scope: RequestScope, id: string, version: number, page: number) {
  return db.$transaction(async tx => {
    const document = await scopedDocument(tx, scope, id, version);
    if (!Number.isInteger(page) || page < 0 || page >= document.pageCount) throw new Error("NOT_FOUND");
    const plain = decryptIdentity(document.encryptedPages!, binding(document.reservationId, version));
    try {
      const pages = JSON.parse(plain.toString()) as string[];
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: document.reservation.facilityId, actorId: scope.userId, action: "identity_document.previewed", entityType: "IdentityDocument", entityId: id, after: { version, page } } });
      return Buffer.from(pages[page], "base64");
    } finally { plain.fill(0); }
  });
}
export const replacementReasons = ["Image is not clear enough", "Document is incomplete", "Document details need clarification", "Document is not supported"] as const;
export async function reviewIdentity(scope: RequestScope, id: string, version: number, decision: "ACCEPT" | "REPLACE", reason?: string) {
  return db.$transaction(async tx => {
    const document = await scopedDocument(tx, scope, id, version);
    // A handed-over identity remains readable to authorised staff, not mutable through onboarding review.
    if (document.reservation.status !== "ACTIVE") throw new Error("ID_CHANGED");
    if (decision === "ACCEPT") {
      for (let page = 0; page < document.pageCount; page++) {
        const preview = await tx.auditEvent.findFirst({ where: { actorId: scope.userId, entityId: id, action: "identity_document.previewed", AND: [{ after: { path: ["version"], equals: version } }, { after: { path: ["page"], equals: page } }] } });
        if (!preview) throw new Error("ID_PREVIEW_REQUIRED");
      }
    } else if (!replacementReasons.some(value => value === reason)) throw new Error("ID_REASON_REQUIRED");
    await tx.identityDocument.update({ where: { id }, data: { status: decision === "ACCEPT" ? "ACCEPTED" : "REPLACEMENT_REQUIRED", reviewedAt: new Date(), reviewedById: scope.userId, replacementReason: decision === "REPLACE" ? reason : null, ...(decision === "REPLACE" ? { encryptedPages: null, erasedAt: new Date() } : {}) } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: document.reservation.facilityId, actorId: scope.userId, action: "identity_document.reviewed", entityType: "IdentityDocument", entityId: id, after: { version, decision, reason: decision === "REPLACE" ? reason : null } } });
  });
}
export async function expireIdentityDocuments() {
  const now = new Date();
  // Use the retention mode recorded at upload, never today's policy: a new policy cannot extend an old acknowledgement.
  const due: Prisma.IdentityDocumentWhereInput = { encryptedPages: { not: null }, OR: [
    { retentionMode: "FIXED_PERIOD", OR: [{ expiresAt: { lte: now } }, { reservation: { status: "CONVERTED" } }] },
    { reservation: { status: { in: ["CANCELLED", "EXPIRED"] } } },
    { reservation: { status: "ACTIVE", holdExpiresAt: { lte: now }, publicLease: { isNot: { status: "SIGNED" } } } },
    { retentionMode: "TENANCY", reservation: { status: "CONVERTED", OR: [{ convertedTenancyId: null }, { convertedTenancy: { status: { in: ["CLOSED", "CANCELLED"] } } }] } },
  ] };
  const documents = await db.identityDocument.findMany({ where: due, select: { id: true, reservationId: true }, take: 100 });
  let erased = 0;
  for (const item of documents) {
    await db.$transaction(async tx => {
      await lock(tx, item.reservationId);
      const document = await tx.identityDocument.findFirst({ where: { id: item.id, ...due }, include: { reservation: { include: { customer: true } } } });
      if (!document) return;
      await tx.identityDocument.update({ where: { id: item.id }, data: { encryptedPages: null, erasedAt: now, status: document.status === "ACCEPTED" ? "ACCEPTED" : "EXPIRED" } });
      await tx.auditEvent.create({ data: { organisationId: document.reservation.customer.organisationId, facilityId: document.reservation.facilityId, action: "identity_document.erased", entityType: "IdentityDocument", entityId: item.id, after: { version: document.version } } }); erased++;
    });
  }
  if (await db.identityDocument.count({ where: due })) throw new Error("ID_RETENTION_BACKLOG");
  await db.identityDocumentMaintenance.upsert({ where: { id: "expiry" }, create: { id: "expiry", completedAt: now }, update: { completedAt: now } });
  return erased;
}
