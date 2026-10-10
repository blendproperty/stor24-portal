import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import type { Prisma } from "@/generated/prisma/client";

const include = { document: true, mandate: true, tenancy: { include: { customer: true, facility: true, account: true, reservation: { include: { publicLease: true } }, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { include: { unitType: true } } } } } } } satisfies Prisma.DebitMandateSessionInclude;
type Session = NonNullable<Awaited<ReturnType<typeof readStaffMandateSession>>>;

function source(document: { id: string; externalId: string | null; signedAt: Date | null }, occupancy: { id: string; unitId: string; monthlyRate: { toString(): string } }, tenancy: { startDate: Date; customerId: string; accountId: string; facilityId: string }) {
  return { documentId: document.id, envelopeId: document.externalId, signedAt: document.signedAt?.toISOString(), occupancyId: occupancy.id, unitId: occupancy.unitId, monthlyRate: occupancy.monthlyRate.toString(), startDate: tenancy.startDate.toISOString(), customerId: tenancy.customerId, accountId: tenancy.accountId, facilityId: tenancy.facilityId };
}
export function assertStaffMandateSource(session: { document: { id: string; type: string; status: string; provider: string | null; externalId: string | null; signedAt: Date | null }; tenancy: { customerId: string; accountId: string; facilityId: string; status: string; paymentMethod: string | null; startDate: Date; occupancies: Array<{ id: string; unitId: string; monthlyRate: { toString(): string } }> }; source: unknown }) {
  const { document, tenancy } = session;
  if (document.type !== "LEASE_AGREEMENT" || document.provider !== "BLENDSIGN" || document.status !== "SIGNED" || !document.signedAt || !document.externalId || tenancy.paymentMethod !== "DEBIT_ORDER" || !["DRAFT", "ACTIVE", "NOTICE_GIVEN"].includes(tenancy.status) || tenancy.occupancies.length !== 1) throw new Error("MANDATE_BOOKING_UNAVAILABLE");
  const expected = source(document, tenancy.occupancies[0], tenancy);
  const stored = session.source as Record<string, unknown> | null;
  if (!stored || Object.keys(stored).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => stored[key] !== value)) throw new Error("MANDATE_AGREEMENT_CHANGED");
}

export async function prepareStaffMandateSession(scope: RequestScope, documentId: string, tenantCustomer?: Prisma.CustomerWhereInput) {
  return db.$transaction(async tx => {
    const query = { where: { id: documentId, tenancy: { facility: facilityWhere(scope), ...(tenantCustomer ? { customer: tenantCustomer } : {}) } }, include: { tenancy: { include: { customer: true, account: true, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } } }, reservation: { include: { publicLease: { include: { mandate: true } } } } } } } } satisfies Prisma.DocumentFindFirstArgs;
    const initial = await tx.document.findFirst(query);
    if (!initial) throw new Error("NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "Tenancy" WHERE "id" = ${initial.tenancyId} FOR UPDATE`;
    const document = await tx.document.findFirst(query);
    if (!document) throw new Error("NOT_FOUND");
    if (document.tenancy.account.customerId !== document.tenancy.customerId || document.tenancy.customer.organisationId !== scope.organisationId) throw new Error("MANDATE_AGREEMENT_CHANGED");
    const occupancy = document.tenancy.occupancies[0];
    if (!occupancy || Number(occupancy.monthlyRate) <= 0) throw new Error("MANDATE_AGREEMENT_CHANGED");
    const snapshot = source(document, occupancy, document.tenancy);
    assertStaffMandateSource({ document, tenancy: document.tenancy, source: snapshot });
    const existing = await tx.debitMandateSession.findUnique({ where: { tenancyId: document.tenancyId }, include });
    if (existing) {
      if (existing.documentId !== documentId) throw new Error("MANDATE_AGREEMENT_CHANGED");
      assertStaffMandateSource(existing);
    }
    const publicLease = document.tenancy.reservation?.publicLease;
    if (!existing && publicLease?.status === "SIGNED" && publicLease.paymentMethod === "DEBIT_ORDER") {
      if (publicLease.expiresAt <= new Date() || document.tenancy.reservation!.status !== "ACTIVE") throw new Error("MANDATE_BOOKING_UNAVAILABLE");
      return { setupUrl: `https://stor24.co.za/book/debit-order/${encodeURIComponent(publicLease.signingToken)}`, status: publicLease.mandate?.status ?? "NOT_STARTED" };
    }
    const expired = existing && existing.expiresAt <= new Date();
    const session = existing && !expired ? existing : await tx.debitMandateSession.upsert({ where: { tenancyId: document.tenancyId }, create: { tenancyId: document.tenancyId, documentId, signingToken: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.now() + 7 * 86400_000), monthlyRate: occupancy.monthlyRate, source: snapshot }, update: { signingToken: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.now() + 7 * 86400_000) }, include });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: document.tenancy.facilityId, ...(tenantCustomer ? {} : { actorId: scope.userId }), action: "debit_mandate.customer_session_prepared", entityType: "DebitMandateSession", entityId: session.id, after: { documentId, noCollectionInitiated: true, initiatedBy: tenantCustomer ? "CUSTOMER" : "STAFF" } } });
    return { setupUrl: `https://stor24.co.za/book/debit-order/${encodeURIComponent(session.signingToken)}`, status: session.mandate?.status ?? "NOT_STARTED" };
  });
}

export async function readStaffMandateSession(token: string) {
  const session = await db.debitMandateSession.findUnique({ where: { signingToken: token }, include });
  if (!session || session.expiresAt <= new Date()) return null;
  if (session.tenancy.account.customerId !== session.tenancy.customerId || session.tenancy.customer.organisationId !== session.tenancy.facility.organisationId) throw new Error("MANDATE_AGREEMENT_CHANGED");
  assertStaffMandateSource(session);
  return session;
}

export function staffMandateLease(session: Session) {
  const { tenancy, document } = session;
  const occupancy = tenancy.occupancies[0];
  return { id: session.id, sourceSessionId: session.id, status: "SIGNED", paymentMethod: "DEBIT_ORDER", signingToken: session.signingToken, expiresAt: session.expiresAt, signedAt: document.signedAt!, debitOrderPreferences: session.preferences, debitOrderRequestedAt: session.requestedAt, mandate: session.mandate,
    reservation: { id: tenancy.reservation?.id ?? tenancy.id, status: "ACTIVE", publicReference: `ST24-D-${session.id}`, customerId: tenancy.customerId, customer: tenancy.customer, facilityId: tenancy.facilityId, facility: tenancy.facility, unit: occupancy.unit, quotedRate: session.monthlyRate, intendedMoveIn: tenancy.startDate } };
}

export async function findMandateLease(token: string) {
  const publicLease = await db.publicReservationLease.findUnique({ where: { signingToken: token }, include: { mandate: true, reservation: { include: { customer: true, facility: true, unit: { include: { unitType: true } } } } } });
  if (publicLease) {
    if (publicLease.status !== "SIGNED" || publicLease.paymentMethod !== "DEBIT_ORDER") throw new Error("MANDATE_BOOKING_UNAVAILABLE");
    return { ...publicLease, sourceSessionId: null };
  }
  const session = await readStaffMandateSession(token);
  if (!session) throw new Error("MANDATE_BOOKING_UNAVAILABLE");
  return staffMandateLease(session);
}

export async function staffMandateBooking(token: string) {
  const session = await readStaffMandateSession(token);
  if (!session) return null;
  const lease = staffMandateLease(session);
  return { reference: lease.reservation.publicReference, status: "SIGNED", paymentMethod: "DEBIT_ORDER", facilityName: lease.reservation.facility.name, unitNumber: lease.reservation.unit.number, monthlyRateZar: Number(session.monthlyRate), intendedMoveIn: session.tenancy.startDate.toISOString(), debitOrderPreferences: session.preferences, debitOrderRequestedAt: session.requestedAt?.toISOString() ?? null, debitOrderSetupAvailable: true, signedPdfAvailable: false, agreementSource: "STAFF_LEASE", agreementDocumentId: session.documentId };
}
