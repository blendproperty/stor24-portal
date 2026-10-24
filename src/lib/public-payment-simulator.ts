import {publicCheckoutTotal} from "./public-initial-rent";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { runSimulatedPaymentFollowUp } from "@/lib/public-payment-follow-up";
import { reservationAccessMatches } from "@/lib/booking-access";

export type SimulatedPaymentOutcome = "SUCCESS" | "DECLINED" | "CANCELLED" | "TIMEOUT";

export function publicPaymentSimulatorEnabled(raw = process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED) {
  return raw?.trim().toLowerCase() === "true";
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSimulatedPayment(reference: string, idempotencyKey: string, accessToken = "") {
  if (!publicPaymentSimulatorEnabled()) return { ok: false as const, code: "DISABLED" };
  return db.$transaction(async tx => {
    const target = await tx.reservation.findUnique({ where: { publicReference: reference }, select: { id: true } });
    if (!target) return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${target.id} FOR UPDATE`;
    const reservation = await tx.reservation.findUnique({
      where: { publicReference: reference },
      include: { facility: true, unit: true, customer: true, publicLease: true, packageSelection: true, publicPaymentSessions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!reservation || !reservationAccessMatches(accessToken, reservation)) return { ok: false as const, code: "ID_SESSION_REQUIRED" };
    if (!reservation || reservation.status !== "ACTIVE" || !reservation.contactVerifiedAt || !reservation.customer.emailVerifiedAt || reservation.journey !== "RENTAL")
      return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };

    const existing = reservation.publicPaymentSessions[0];
    if (existing?.status === "SUCCEEDED") return { ok: false as const, code: "ALREADY_PAID" };
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
    const providerReference = `SIM-${randomBytes(6).toString("hex").toUpperCase()}`;
    const session = await tx.publicPaymentSession.create({ data: {
      reservationId: reservation.id, amount: publicCheckoutTotal(reservation), currency: "ZAR",
      description: `Initial storage and selected goods - Unit ${reservation.unit.number}`,
      checkoutTokenHash: tokenHash(token), idempotencyKey, providerReference, expiresAt,
    }});
    await tx.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: "public_payment.simulator_started", entityType: "PublicPaymentSession", entityId: session.id, requestId: idempotencyKey, after: { providerReference, amount: session.amount.toString(), expiresAt: expiresAt.toISOString() } } });
    return { ok: true as const, sessionId: session.id, checkoutToken: token, providerReference, expiresAt: expiresAt.toISOString(), amountZar: Number(session.amount), currency: session.currency, description: session.description, facilityName: reservation.facility.name, unitNumber: reservation.unit.number, customerName: reservation.customer.firstName };
  });
}

export async function completeSimulatedPayment(sessionId: string, checkoutToken: string, outcome: SimulatedPaymentOutcome, paymentMethod?: "DEBIT_ORDER" | "CARD" | "EFT", accessToken = "") {
  if (!publicPaymentSimulatorEnabled()) return { ok: false as const, code: "DISABLED" };
  const target = await db.publicPaymentSession.findUnique({ where: { id: sessionId }, select: { reservationId: true, checkoutTokenHash: true } });
  if (!target || tokenHash(checkoutToken) !== target.checkoutTokenHash) return { ok: false as const, code: "NOT_FOUND" };
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${target.reservationId} FOR UPDATE`;
    const session = await tx.publicPaymentSession.findUnique({ where: { id: sessionId }, include: { reservation: { include: { customer: true, unit: true, facility: true, publicLease: true } } } });
    if (!session || tokenHash(checkoutToken) !== session.checkoutTokenHash) return { ok: false as const, code: "NOT_FOUND" };
    const reservation = session.reservation;
    if (!reservationAccessMatches(accessToken, reservation)) return { ok: false as const, code: "ID_SESSION_REQUIRED" };
    if (!reservation.contactVerifiedAt || !reservation.customer.emailVerifiedAt || reservation.journey !== "RENTAL" || (session.status === "PENDING" && reservation.status !== "ACTIVE") || (session.status === "SUCCEEDED" && !["ACTIVE", "CONVERTED"].includes(reservation.status))) return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };
    if (session.status !== "PENDING") {
      if (!session.paymentMethod && paymentMethod) await tx.publicPaymentSession.update({ where: { id: session.id }, data: { paymentMethod } });
      return { ok: true as const, status: session.status, idempotent: true, session };
    }
    if (!paymentMethod) return { ok: false as const, code: "PAYMENT_METHOD_REQUIRED" };
    const effectiveOutcome: SimulatedPaymentOutcome = session.expiresAt <= new Date() ? "TIMEOUT" : outcome;
    const status = effectiveOutcome === "SUCCESS" ? "SUCCEEDED" : effectiveOutcome;
    const now = new Date();
    await tx.publicPaymentSession.update({ where: { id: session.id }, data: { status, paymentMethod, failureCode: effectiveOutcome === "SUCCESS" ? null : effectiveOutcome, processedAt: now } });
    if (effectiveOutcome === "SUCCESS") {
      await tx.reservation.update({ where: { id: session.reservationId }, data: { holdExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } });
      if (reservation.leadId) await tx.lead.update({ where: { id: reservation.leadId }, data: { stage: "QUALIFIED" } });
    } else {
      const cancelled = await tx.reservation.updateMany({ where: { id: session.reservationId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      if (cancelled.count) await tx.unit.updateMany({ where: { id: reservation.unitId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
    }
    await tx.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: `public_payment.simulator_${status.toLowerCase()}`, entityType: "PublicPaymentSession", entityId: session.id, requestId: session.idempotencyKey, after: { status, paymentMethod, simulated: true } } });
    return { ok: true as const, status, idempotent: false, session };
  });
  if (!result.ok) return result;
  const { session, status, idempotent } = result;
  const followUp = status === "SUCCEEDED" ? await runSimulatedPaymentFollowUp(session.id) : null;
  return { ok: true as const, status, idempotent, followUpStatus: followUp?.status, signingUrl: followUp && "signingUrl" in followUp ? followUp.signingUrl : undefined, leaseInvitationSent: followUp && "leaseInvitationSent" in followUp ? followUp.leaseInvitationSent : false, whatsappConfirmationSent: followUp && "whatsappConfirmationSent" in followUp ? followUp.whatsappConfirmationSent : false, reference: session.reservation.publicReference, providerReference: session.providerReference };
}
