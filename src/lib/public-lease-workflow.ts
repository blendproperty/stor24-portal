import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { welcomeTenantWhenReady } from "@/lib/tenant-welcome-email";
import {
  LEASE_CLAUSE_KEYS,
  LEASE_VERSION,
  renderLeaseDocument,
  type LeaseClauseKey,
  type PublicLeasePaymentMethod,
} from "@/lib/lease-agreement-content";
import { renderSignedLeasePdf } from "@/lib/public-lease-pdf";
import { buildReviewLeaseClauses, renderReviewLeaseDocument, STORAGE_TERMS_VERSION } from "@/lib/storage-terms";

const signingWindowMs = 7 * 24 * 60 * 60 * 1000;

function customerName(customer: { companyName: string | null; firstName: string | null; lastName: string | null }) {
  return customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer";
}

function publicLeaseExpiry(holdExpiresAt: Date | null, now = new Date()) {
  const maximum = new Date(now.getTime() + signingWindowMs);
  return holdExpiresAt && holdExpiresAt < maximum ? holdExpiresAt : maximum;
}

export async function preparePublicReservationLease(reference: string, paymentMethod: PublicLeasePaymentMethod) {
  const reservation = await db.reservation.findUnique({
    where: { publicReference: reference },
    include: { customer: true, facility: true, unit: { include: { unitType: true } }, publicLease: true, packageSelection: true },
  });
  if (!reservation || reservation.status !== "ACTIVE" || reservation.journey !== "RENTAL" || !reservation.contactVerifiedAt || !reservation.customer.emailVerifiedAt) {
    return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };
  }
  if (!reservation.intendedMoveIn) return { ok: false as const, code: "MOVE_IN_DATE_REQUIRED" };

  const context = {
    facilityName: reservation.facility.name,
    unitNumber: reservation.unit.number,
    unitTypeName: reservation.unit.unitType.name,
    customerName: customerName(reservation.customer),
    monthlyRate: Number(reservation.quotedRate),
    startDate: reservation.intendedMoveIn,
    paymentMethod,
    storagePackage: reservation.packageSelection ? {
      name: reservation.packageSelection.packageName,
      priceZar: Number(reservation.packageSelection.priceSnapshot),
      contents: (reservation.packageSelection.itemsSnapshot as Array<{ name: string; quantity: number }>).map((item) => `${item.quantity} x ${item.name}`).join(", "),
    } : null,
  };
  // Keep historical signed agreements on their original renderer, while still
  // detecting a changed price, goods selection or payment method.
  const legacySigned = reservation.publicLease?.status === "SIGNED" && reservation.publicLease.version === LEASE_VERSION;
  if (reservation.publicLease?.status === "SIGNED" && !legacySigned && reservation.publicLease.version !== STORAGE_TERMS_VERSION) return { ok: false as const, code: "SIGNED_LEASE_CHANGED" };
  const content = legacySigned ? renderLeaseDocument(context) : renderReviewLeaseDocument(context);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const clauses = buildReviewLeaseClauses(context);
  const now = new Date();

  if (reservation.publicLease?.status === "SIGNED") {
    if (reservation.publicLease.sha256 !== sha256) return { ok: false as const, code: "SIGNED_LEASE_CHANGED" };
    return { ok: true as const, status: "SIGNED" as const, token: reservation.publicLease.signingToken, reference, signedAt: reservation.publicLease.signedAt?.toISOString() ?? null };
  }

  const token = reservation.publicLease?.expiresAt && reservation.publicLease.expiresAt > now
    ? reservation.publicLease.signingToken
    : randomBytes(32).toString("base64url");
  const lease = await db.publicReservationLease.upsert({
    where: { reservationId: reservation.id },
    create: { reservationId: reservation.id, version: STORAGE_TERMS_VERSION, paymentMethod, content, clauses, sha256, signingToken: token, expiresAt: publicLeaseExpiry(reservation.holdExpiresAt, now) },
    update: { status: "READY", version: STORAGE_TERMS_VERSION, paymentMethod, content, clauses, sha256, signingToken: token, expiresAt: publicLeaseExpiry(reservation.holdExpiresAt, now), signerName: null, signerIp: null, signerUserAgent: null, initials: undefined, signedAt: null, signedPdf: null, signedPdfSha256: null },
  });
  await db.reservation.update({ where: { id: reservation.id }, data: { paymentMethod } });
  await db.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: "public_lease.prepared", entityType: "PublicReservationLease", entityId: lease.id, requestId: reservation.idempotencyKey, after: { reservationId: reservation.id, version: lease.version, paymentMethod, sha256: lease.sha256, expiresAt: lease.expiresAt.toISOString() } } });
  return { ok: true as const, status: "READY" as const, token: lease.signingToken, reference, expiresAt: lease.expiresAt.toISOString() };
}

export async function getPublicReservationLease(token: string) {
  const lease = await db.publicReservationLease.findUnique({
    where: { signingToken: token },
    include: { reservation: { include: { customer: true, facility: true, unit: { include: { unitType: true } } } } },
  });
  if (!lease) return null;
  if (lease.status !== "SIGNED" && lease.reservation.status !== "ACTIVE") return null;
  return {
    reference: lease.reservation.publicReference,
    status: lease.status,
    expired: lease.status === "READY" && lease.expiresAt < new Date(),
    version: lease.version,
    sha256: lease.sha256,
    content: lease.content,
    requiresTermsAcceptance: lease.version === STORAGE_TERMS_VERSION,
    clauses: lease.clauses,
    expiresAt: lease.expiresAt.toISOString(),
    signedAt: lease.signedAt?.toISOString() ?? null,
    signerName: lease.signerName,
    customerName: customerName(lease.reservation.customer),
    facilityName: lease.reservation.facility.name,
    unitNumber: lease.reservation.unit.number,
    unitTypeName: lease.reservation.unit.unitType.name,
    monthlyRateZar: Number(lease.reservation.quotedRate),
    intendedMoveIn: lease.reservation.intendedMoveIn?.toISOString() ?? null,
    paymentMethod: lease.paymentMethod,
    signedPdfAvailable: Boolean(lease.signedPdf && lease.signedPdfSha256),
    debitOrderPreferences: lease.debitOrderPreferences,
    debitOrderRequestedAt: lease.debitOrderRequestedAt?.toISOString() ?? null,
    debitOrderSetupAvailable: lease.reservation.status === "ACTIVE" && lease.expiresAt > new Date(),
  };
}

export async function completePublicReservationLease(token: string, input: { signerName: string; initials: LeaseClauseKey[]; signerIp: string | null; signerUserAgent: string | null; termsAccepted?: boolean; acceptedSha256?: string }) {
  if (LEASE_CLAUSE_KEYS.some((key) => !input.initials.includes(key))) throw new Error("VALIDATION_ERROR");
  let recipient: { id: string; organisationId: string } | undefined;
  const result = await db.$transaction(async (tx) => {
    const lease = await tx.publicReservationLease.findUnique({ where: { signingToken: token }, include: { reservation: { include: { customer: true } } } });
    if (!lease) throw new Error("NOT_FOUND");
    recipient = lease.reservation.customer;
    if (lease.status === "SIGNED") return { reference: lease.reservation.publicReference, status: "SIGNED" as const, idempotent: true };
    if (lease.status !== "READY" || lease.reservation.status !== "ACTIVE") throw new Error("NOT_FOUND");
    if (lease.expiresAt < new Date()) throw new Error("EXPIRED");
    if (lease.version === STORAGE_TERMS_VERSION && (input.termsAccepted !== true || input.acceptedSha256 !== lease.sha256)) throw new Error("VALIDATION_ERROR");
    const signedAt = new Date();
    const initials = [...LEASE_CLAUSE_KEYS.map((clauseKey) => ({ clauseKey: String(clauseKey), initialedAt: signedAt.toISOString() })), ...(lease.version === STORAGE_TERMS_VERSION ? [{ clauseKey: `full_terms:${lease.version}:${lease.sha256}`, initialedAt: signedAt.toISOString() }] : [])];
    const pdf = await renderSignedLeasePdf({ content: lease.content, reference: lease.reservation.publicReference!, paymentMethod: lease.paymentMethod, signerName: input.signerName, signedAt, sha256: lease.sha256 });
    const signedPdfSha256 = createHash("sha256").update(pdf).digest("hex");
    const changed = await tx.publicReservationLease.updateMany({ where: { id: lease.id, status: "READY", signedAt: null }, data: { status: "SIGNED", signerName: input.signerName, signerIp: input.signerIp, signerUserAgent: input.signerUserAgent, initials, signedAt, signedPdf: Buffer.from(pdf), signedPdfSha256 } });
    if (!changed.count) throw new Error("CONFLICT");
    await tx.auditEvent.create({ data: { organisationId: lease.reservation.customer.organisationId, facilityId: lease.reservation.facilityId, action: "public_lease.signed", entityType: "PublicReservationLease", entityId: lease.id, requestId: lease.reservation.idempotencyKey, after: { reservationId: lease.reservationId, version: lease.version, paymentMethod: lease.paymentMethod, sha256: lease.sha256, signedPdfSha256, signedAt: signedAt.toISOString() } } });
    return { reference: lease.reservation.publicReference, status: "SIGNED" as const, signedAt: signedAt.toISOString(), idempotent: false };
  });
  if (recipient) await welcomeTenantWhenReady(recipient.id, recipient.organisationId);
  return result;
}

export async function publicReservationHasSignedLease(reference: string) {
  const lease = await db.publicReservationLease.findFirst({ where: { reservation: { publicReference: reference }, status: "SIGNED", signedAt: { not: null } }, select: { id: true, version: true, sha256: true, signedAt: true } });
  return lease;
}
