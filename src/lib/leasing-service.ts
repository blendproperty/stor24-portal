import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, requireFacility, type RequestScope } from "@/lib/scope";
import { revokeBiometricAccess } from "@/lib/biometric-access-service";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { LEASE_CLAUSE_KEYS, type LeaseClauseKey } from "@/lib/lease-agreement-content";
import { blendSignTemplateKey, type BlendSignEnvelope } from "@/lib/blendsign-client";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const SIGNING_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PENDING_MOVE_IN_CHARGE_DESCRIPTION = "Move-in charge (pending lease signature)";
export const COMPLETED_MOVE_IN_CHARGE_DESCRIPTION = "Move-in charge";

function audit(tx: Tx, scope: RequestScope, action: string, entityType: string, entityId: string, facilityId?: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) {
  return tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action, entityType, entityId, before, after } });
}

function completeMoveInCharge(tx: Tx, accountId: string) {
  return tx.ledgerEntry.updateMany({
    where: { accountId, type: "CHARGE", description: PENDING_MOVE_IN_CHARGE_DESCRIPTION },
    data: { description: COMPLETED_MOVE_IN_CHARGE_DESCRIPTION },
  });
}

export function hashDocument(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function listLeasing(scope: RequestScope) {
  const facilities = await db.facility.findMany({
    where: facilityWhere(scope), orderBy: { name: "asc" },
    include: { unitTypes: { orderBy: { name: "asc" } }, units: { include: { unitType: true }, orderBy: { number: "asc" } } },
  });
  const facilityIds = facilities.map((facility) => facility.id);
  const [customers, leads, reservations, tenancies] = await Promise.all([
    db.customer.findMany({ where: { organisationId: scope.organisationId }, include: { leads: { orderBy: { updatedAt: "desc" }, take: 10 }, reservations: { include: { facility: true, unit: true }, orderBy: { updatedAt: "desc" }, take: 10 }, tenancies: { include: { facility: true, account: true, occupancies: { include: { unit: { include: { unitType: true } } }, orderBy: { startDate: "desc" } }, documents: { where: { type: "LEASE_AGREEMENT" }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } } }, orderBy: { updatedAt: "desc" } }),
    db.lead.findMany({ where: { facilityId: { in: facilityIds } }, include: { customer: true, desiredUnitType: true, facility: true }, orderBy: { updatedAt: "desc" } }),
    db.reservation.findMany({ where: { facilityId: { in: facilityIds } }, include: { customer: true, unit: true, facility: true }, orderBy: { updatedAt: "desc" } }),
    db.tenancy.findMany({ where: { facilityId: { in: facilityIds } }, include: { customer: true, account: true, facility: true, occupancies: { include: { unit: true }, orderBy: { startDate: "desc" } }, documents: { where: { type: "LEASE_AGREEMENT" }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
  ]);
  return { facilities, customers, leads, reservations, tenancies };
}

export async function createFacility(scope: RequestScope, data: Omit<Prisma.FacilityUncheckedCreateInput, "organisationId">) {
  if (!scope.unrestrictedFacilities) throw new Error("FORBIDDEN");
  return db.$transaction(async (tx) => { const entity = await tx.facility.create({ data: { ...data, organisationId: scope.organisationId } }); await audit(tx, scope, "facility.created", "Facility", entity.id, entity.id, undefined, entity as unknown as Prisma.InputJsonValue); return entity; });
}

export async function createUnitType(scope: RequestScope, data: Prisma.UnitTypeUncheckedCreateInput) {
  await requireFacility(scope, data.facilityId); return db.$transaction(async (tx) => { const entity = await tx.unitType.create({ data }); await audit(tx, scope, "unit_type.created", "UnitType", entity.id, data.facilityId); return entity; });
}

export async function createUnit(scope: RequestScope, data: Prisma.UnitUncheckedCreateInput) {
  await requireFacility(scope, data.facilityId); const type = await db.unitType.findFirst({ where: { id: data.unitTypeId, facilityId: data.facilityId } }); if (!type) throw new Error("FACILITY_FORBIDDEN");
  return db.$transaction(async (tx) => { const entity = await tx.unit.create({ data }); await audit(tx, scope, "unit.created", "Unit", entity.id, data.facilityId); return entity; });
}

export async function createCustomer(scope: RequestScope, data: Omit<Prisma.CustomerUncheckedCreateInput, "organisationId">) {
  return db.$transaction(async (tx) => { const entity = await tx.customer.create({ data: { ...data, organisationId: scope.organisationId } }); await audit(tx, scope, "customer.created", "Customer", entity.id); return entity; });
}

export async function createLead(scope: RequestScope, data: Prisma.LeadUncheckedCreateInput) {
  await requireFacility(scope, data.facilityId); if (data.customerId && !(await db.customer.findFirst({ where: { id: data.customerId, organisationId: scope.organisationId } }))) throw new Error("FORBIDDEN");
  return db.$transaction(async (tx) => { const entity = await tx.lead.create({ data }); await audit(tx, scope, "lead.created", "Lead", entity.id, data.facilityId); return entity; });
}

export async function createReservation(scope: RequestScope, data: Prisma.ReservationUncheckedCreateInput) {
  await requireFacility(scope, data.facilityId);
  return db.$transaction(async (tx) => {
    const unit = await tx.unit.findFirst({ where: { id: data.unitId, facilityId: data.facilityId, status: "AVAILABLE" } });
    const customer = await tx.customer.findFirst({ where: { id: data.customerId, organisationId: scope.organisationId } });
    if (!unit || !customer) throw new Error("CONFLICT");
    const entity = await tx.reservation.create({ data }); await tx.unit.update({ where: { id: unit.id }, data: { status: "RESERVED" } });
    if (data.leadId) await tx.lead.update({ where: { id: data.leadId }, data: { stage: "RESERVED" } });
    await audit(tx, scope, "reservation.created", "Reservation", entity.id, data.facilityId); return entity;
  });
}

export async function cancelReservation(scope: RequestScope, reservationId: string) {
  const reservation = await db.reservation.findFirst({ where: { id: reservationId }, include: { unit: true } });
  if (!reservation) throw new Error("NOT_FOUND"); await requireFacility(scope, reservation.facilityId); if (reservation.status !== "ACTIVE") throw new Error("CONFLICT");
  return db.$transaction(async (tx) => {
    const entity = await tx.reservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED" } });
    const otherActive = await tx.reservation.count({ where: { unitId: reservation.unitId, status: "ACTIVE", id: { not: reservation.id } } });
    const activeOccupancy = await tx.occupancy.count({ where: { unitId: reservation.unitId, status: "ACTIVE" } });
    if (!otherActive && !activeOccupancy && reservation.unit.status === "RESERVED") await tx.unit.update({ where: { id: reservation.unitId }, data: { status: "AVAILABLE" } });
    await audit(tx, scope, "reservation.cancelled", "Reservation", entity.id, reservation.facilityId); return entity;
  });
}

/**
 * Starts a move-in for a BlendSign lease. Creates the Account, a DRAFT
 * Tenancy, a PENDING Occupancy (the unit stays RESERVED, not OCCUPIED),
 * and a pending Document carrying the selected template and idempotency
 * key. The caller creates the external envelope after this transaction,
 * keeping the database transaction free of network calls.
 *
 * The Tenancy/Occupancy only become ACTIVE/OCCUPIED once the customer
 * actually signs, via the authenticated BlendSign webhook.
 */
export async function moveIn(scope: RequestScope, input: { reservationId?: string; facilityId: string; customerId: string; unitId: string; startDate: Date; monthlyRate?: number; initialCharge: number; accessState: string; paymentMethod: "DEBIT_ORDER" | "CARD" | "EFT" | "OTHER"; simulation?: boolean }) {
  await requireFacility(scope, input.facilityId);
  return db.$transaction(async (tx) => {
    const unit = await tx.unit.findFirst({ where: { id: input.unitId, facilityId: input.facilityId, status: { in: ["AVAILABLE", "RESERVED"] } }, include: { unitType: true } });
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, organisationId: scope.organisationId } });
    const facility = await tx.facility.findFirst({ where: { id: input.facilityId } });
    if (!unit || !customer || !facility) throw new Error("CONFLICT");
    const account = await tx.account.create({ data: { customerId: customer.id, accountNumber: `ST24-${Date.now().toString(36).toUpperCase()}` } });
    const monthlyRate = input.monthlyRate ?? unit.monthlyRate;
    const tenancy = await tx.tenancy.create({ data: { facilityId: input.facilityId, customerId: customer.id, accountId: account.id, status: "DRAFT", startDate: input.startDate, paymentMethod: input.paymentMethod, occupancies: { create: { unitId: unit.id, status: "PENDING", startDate: input.startDate, monthlyRate, accessState: input.accessState } } } });
    // Hold the unit while the lease is out for signature, but do not occupy it yet.
    await tx.unit.update({ where: { id: unit.id }, data: { status: "RESERVED" } });
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + SIGNING_LINK_TTL_MS);
    const document = await tx.document.create({ data: { tenancyId: tenancy.id, type: input.simulation ? "LEASE_AGREEMENT_UAT" : "LEASE_AGREEMENT", storageKey: "blendsign:pending", provider: "BLENDSIGN", templateKey: blendSignTemplateKey(input.paymentMethod), idempotencyKey: `stor24-lease:${tenancy.id}`, status: "PENDING", sentAt, expiresAt } });
    if (input.initialCharge > 0) { await tx.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: input.initialCharge, description: PENDING_MOVE_IN_CHARGE_DESCRIPTION, effectiveAt: input.startDate, createdById: scope.userId } }); await tx.account.update({ where: { id: account.id }, data: { balance: { increment: input.initialCharge } } }); }
    if (input.reservationId) await tx.reservation.update({ where: { id: input.reservationId }, data: { status: "CONVERTED", convertedTenancyId: tenancy.id } });
    await audit(tx, scope, "tenancy.lease_sent_for_signature", "Tenancy", tenancy.id, input.facilityId);
    return { tenancy, document, customer, facility, unit };
  });
}

export type MoveInResult = Awaited<ReturnType<typeof moveIn>>;

export async function attachBlendSignEnvelope(scope: RequestScope, documentId: string, envelope: BlendSignEnvelope) {
  const document = await db.document.findFirst({ where: { id: documentId }, include: { tenancy: true } });
  if (!document) throw new Error("NOT_FOUND");
  await requireFacility(scope, document.tenancy.facilityId);
  return db.$transaction(async (tx) => {
    const updated = await tx.document.update({ where: { id: document.id }, data: { externalId: envelope.envelopeId, storageKey: `blendsign:${envelope.envelopeId}`, status: envelope.status } });
    await audit(tx, scope, "tenancy.blendsign_envelope_created", "Document", document.id, document.tenancy.facilityId, undefined, { envelopeId: envelope.envelopeId, templateKey: document.templateKey } as Prisma.InputJsonValue);
    return updated;
  });
}

export async function completeBlendSignEnvelope(envelopeId: string) {
  return db.$transaction(async (tx) => {
    const document = await tx.document.findUnique({ where: { externalId: envelopeId }, include: { tenancy: { include: { occupancies: true, facility: true } } } });
    if (!document) throw new Error("NOT_FOUND");
    if (document.status === "SIGNED") return { tenancyId: document.tenancyId, idempotent: true, simulation: document.type === "LEASE_AGREEMENT_UAT" };
    if (document.type === "LEASE_AGREEMENT_UAT") {
      await tx.document.update({ where: { id: document.id }, data: { status: "SIGNED", signedAt: new Date() } });
      await tx.auditEvent.create({ data: { organisationId: document.tenancy.facility.organisationId, facilityId: document.tenancy.facilityId, actorId: null, action: "tenancy.uat_lease_signed", entityType: "Document", entityId: document.id, after: { envelopeId, simulated: true } } });
      return { tenancyId: document.tenancyId, idempotent: false, simulation: true };
    }
    const occupancy = document.tenancy.occupancies.find((item) => item.status === "PENDING");
    if (!occupancy) throw new Error("CONFLICT");
    await tx.occupancy.update({ where: { id: occupancy.id }, data: { status: "ACTIVE" } });
    await tx.unit.update({ where: { id: occupancy.unitId }, data: { status: "OCCUPIED" } });
    await tx.tenancy.update({ where: { id: document.tenancyId }, data: { status: "ACTIVE" } });
    await completeMoveInCharge(tx, document.tenancy.accountId);
    await tx.document.update({ where: { id: document.id }, data: { status: "SIGNED", signedAt: new Date() } });
    await tx.auditEvent.create({ data: { organisationId: document.tenancy.facility.organisationId, facilityId: document.tenancy.facilityId, actorId: null, action: "tenancy.blendsign_completed", entityType: "Document", entityId: document.id, after: { envelopeId } } });
    return { tenancyId: document.tenancyId, idempotent: false };
  });
}

/**
 * Completes a lease e-signature submitted from the public /sign/[token]
 * page. Unauthenticated by design — the signingToken is the credential,
 * generated with 32 random bytes and single-use per Document. On success,
 * flips the Occupancy to ACTIVE, the Unit to OCCUPIED and the Tenancy to
 * ACTIVE — this is the point at which the deal actually becomes a live
 * tenancy, not the earlier moveIn() call.
 *
 * Throws Error with message NOT_FOUND / ALREADY_SIGNED / EXPIRED /
 * VALIDATION_ERROR so the calling API route can map each to the right
 * HTTP status and customer-facing copy.
 */
export async function completeLeaseSigning(token: string, input: { signerName: string; initials: LeaseClauseKey[]; signerIp: string | null; signerUserAgent: string | null }) {
  const missingClauses = LEASE_CLAUSE_KEYS.filter((key) => !input.initials.includes(key));
  if (missingClauses.length > 0) throw new Error("VALIDATION_ERROR");
  return db.$transaction(async (tx) => {
    const document = await tx.document.findFirst({ where: { signingToken: token }, include: { tenancy: { include: { occupancies: true, facility: true } } } });
    if (!document) throw new Error("NOT_FOUND");
    if (document.status === "SIGNED") throw new Error("ALREADY_SIGNED");
    if (document.status !== "SENT") throw new Error("NOT_FOUND");
    if (document.expiresAt && document.expiresAt < new Date()) throw new Error("EXPIRED");
    const tenancy = document.tenancy;
    const occupancy = tenancy.occupancies.find((item) => item.status === "PENDING");
    if (!occupancy) throw new Error("NOT_FOUND");
    const initialsRecord = LEASE_CLAUSE_KEYS.map((key) => ({ clauseKey: key, initialedAt: new Date().toISOString() }));
    await tx.occupancy.update({ where: { id: occupancy.id }, data: { status: "ACTIVE" } });
    await tx.unit.update({ where: { id: occupancy.unitId }, data: { status: "OCCUPIED" } });
    await tx.tenancy.update({ where: { id: tenancy.id }, data: { status: "ACTIVE" } });
    await completeMoveInCharge(tx, tenancy.accountId);
    await tx.document.update({ where: { id: document.id }, data: { status: "SIGNED", signerName: input.signerName, signerIp: input.signerIp, signerUserAgent: input.signerUserAgent, initials: initialsRecord, signedAt: new Date() } });
    await tx.auditEvent.create({ data: { organisationId: tenancy.facility.organisationId, facilityId: tenancy.facilityId, actorId: null, action: "tenancy.lease_signed", entityType: "Document", entityId: document.id } });
    return { tenancyId: tenancy.id };
  });
}

/**
 * Read-only lookup for the public /sign/[token] page — deliberately returns
 * only what a signer needs to see (no internal IDs, no other tenants'
 * data). Works for SENT (still to sign), SIGNED (already done — shows a
 * confirmation instead of the form) and expired-but-still-SENT documents.
 */
export async function getLeaseForSigning(token: string) {
  const document = await db.document.findFirst({
    where: { signingToken: token },
    include: { tenancy: { include: { customer: true, facility: true, occupancies: { include: { unit: true }, orderBy: { createdAt: "asc" } } } } },
  });
  if (!document) return null;
  const occupancy = document.tenancy.occupancies[0];
  const customerName = document.tenancy.customer.companyName || [document.tenancy.customer.firstName, document.tenancy.customer.lastName].filter(Boolean).join(" ") || "Customer";
  return {
    status: document.status as "SENT" | "SIGNED",
    expired: document.status === "SENT" && Boolean(document.expiresAt) && document.expiresAt! < new Date(),
    signerName: document.signerName,
    signedAt: document.signedAt,
    facilityName: document.tenancy.facility.name,
    unitNumber: occupancy?.unit.number ?? "—",
    customerName,
    monthlyRate: Number(occupancy?.monthlyRate ?? 0),
    startDate: document.tenancy.startDate,
  };
}

export async function transfer(scope: RequestScope, input: { tenancyId: string; toUnitId: string; effectiveAt: Date; monthlyRate?: number }) {
  return db.$transaction(async (tx) => {
    const tenancy = await tx.tenancy.findFirst({ where: { id: input.tenancyId, status: "ACTIVE", facility: facilityWhere(scope) }, include: { occupancies: { where: { status: "ACTIVE" } } } });
    if (!tenancy || tenancy.occupancies.length !== 1) throw new Error("CONFLICT");
    const next = await tx.unit.findFirst({ where: { id: input.toUnitId, facilityId: tenancy.facilityId, status: "AVAILABLE" } }); if (!next) throw new Error("CONFLICT");
    const current = tenancy.occupancies[0];
    await tx.tenancy.update({ where: { id: tenancy.id }, data: { status: "ACTIVE" } });
    await tx.occupancy.update({ where: { id: current.id }, data: { status: "MOVED_OUT", endDate: input.effectiveAt, accessState: "REVOKED" } });
    await tx.unit.update({ where: { id: current.unitId }, data: { status: "AVAILABLE" } });
    const occupancy = await tx.occupancy.create({ data: { tenancyId: tenancy.id, unitId: next.id, status: "ACTIVE", startDate: input.effectiveAt, monthlyRate: input.monthlyRate ?? next.monthlyRate, accessState: "PENDING" } });
    await tx.unit.update({ where: { id: next.id }, data: { status: "OCCUPIED" } }); await audit(tx, scope, "tenancy.transferred", "Tenancy", tenancy.id, tenancy.facilityId); return occupancy;
  });
}

export async function giveNotice(scope: RequestScope, input: { tenancyId: string; noticeDate: Date; plannedMoveOut: Date }) {
  const tenancy = await db.tenancy.findFirst({ where: { id: input.tenancyId, facility: facilityWhere(scope), status: "ACTIVE" } }); if (!tenancy) throw new Error("NOT_FOUND");
  return db.$transaction(async (tx) => { const entity = await tx.tenancy.update({ where: { id: tenancy.id }, data: { status: "NOTICE_GIVEN", noticeDate: input.noticeDate, endDate: input.plannedMoveOut, occupancies: { updateMany: { where: { status: "ACTIVE" }, data: { status: "NOTICE_GIVEN" } } } } }); await audit(tx, scope, "tenancy.notice_given", "Tenancy", entity.id, tenancy.facilityId); return entity; });
}

export async function moveOut(scope: RequestScope, input: { tenancyId: string; movedOutAt: Date; finalCharge: number; notes?: string }) {
  const entity = await db.$transaction(async (tx) => {
    const tenancy = await tx.tenancy.findFirst({ where: { id: input.tenancyId, facility: facilityWhere(scope), status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } } } }); if (!tenancy) throw new Error("NOT_FOUND");
    await tx.occupancy.updateMany({ where: { tenancyId: tenancy.id, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, data: { status: "MOVED_OUT", endDate: input.movedOutAt, accessState: "REVOKED" } });
    await tx.unit.updateMany({ where: { id: { in: tenancy.occupancies.map((o) => o.unitId) } }, data: { status: "AVAILABLE" } });
    const entity = await tx.tenancy.update({ where: { id: tenancy.id }, data: { status: "CLOSED", endDate: input.movedOutAt } });
    if (input.finalCharge > 0) { await tx.ledgerEntry.create({ data: { accountId: tenancy.accountId, type: "CHARGE", amount: input.finalCharge, description: input.notes || "Final move-out charge", effectiveAt: input.movedOutAt, createdById: scope.userId } }); await tx.account.update({ where: { id: tenancy.accountId }, data: { balance: { increment: input.finalCharge } } }); }
    await audit(tx, scope, "tenancy.moved_out", "Tenancy", entity.id, tenancy.facilityId); return entity;
  });
  const activeBiometrics = await db.biometricEnrollment.findMany({ where: { occupancy: { tenancyId: entity.id }, status: "ACTIVE" }, select: { id: true } });
  for (const enrollment of activeBiometrics) await revokeBiometricAccess(scope, enrollment.id);
  const notification = await db.tenancy.findUnique({ where: { id: entity.id }, include: { customer: true, facility: true, occupancies: { include: { unit: true }, orderBy: { updatedAt: "desc" }, take: 1 } } });
  if (notification?.customer.phone) await sendWhatsAppTemplate({ organisationId: scope.organisationId, facilityId: notification.facilityId, customerId: notification.customerId, recipient: notification.customer.phone, consent: notification.customer.communicationConsent, messageType: "MOVE_OUT_CONFIRMATION", idempotencyKey: `move-out:${entity.id}:WHATSAPP`, variables: { "1": notification.customer.firstName || notification.customer.companyName || "customer", "2": notification.occupancies[0]?.unit.number || "", "3": notification.facility.name, "4": input.movedOutAt.toLocaleDateString("en-ZA") } });
  return entity;
}
