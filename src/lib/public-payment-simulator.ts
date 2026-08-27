import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { runSimulatedPaymentFollowUp } from "@/lib/public-payment-follow-up";

export type SimulatedPaymentOutcome = "SUCCESS" | "DECLINED" | "CANCELLED" | "TIMEOUT";

export function publicPaymentSimulatorEnabled(raw = process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED) {
  return raw?.trim().toLowerCase() === "true";
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSimulatedPayment(reference: string, idempotencyKey: string) {
  if (!publicPaymentSimulatorEnabled()) return { ok: false as const, code: "DISABLED" };
  const reservation = await db.reservation.findUnique({
    where: { publicReference: reference },
    include: { facility: true, unit: true, customer: true, publicPaymentSessions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!reservation || reservation.status !== "ACTIVE" || !reservation.contactVerifiedAt || reservation.journey !== "RENTAL")
    return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };

  const existing = reservation.publicPaymentSessions[0];
  if (existing?.status === "SUCCEEDED") return { ok: false as const, code: "ALREADY_PAID" };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
  const providerReference = `SIM-${randomBytes(6).toString("hex").toUpperCase()}`;
  const session = await db.publicPaymentSession.create({ data: {
    reservationId: reservation.id, amount: reservation.quotedRate, currency: "ZAR",
    description: `First month's storage - Unit ${reservation.unit.number}`,
    checkoutTokenHash: tokenHash(token), idempotencyKey, providerReference, expiresAt,
  }});
  await db.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: "public_payment.simulator_started", entityType: "PublicPaymentSession", entityId: session.id, requestId: idempotencyKey, after: { providerReference, amount: session.amount.toString(), expiresAt: expiresAt.toISOString() } } });
  return { ok: true as const, sessionId: session.id, checkoutToken: token, providerReference, expiresAt: expiresAt.toISOString(), amountZar: Number(session.amount), currency: session.currency, description: session.description, facilityName: reservation.facility.name, unitNumber: reservation.unit.number, customerName: reservation.customer.firstName };
}

export async function completeSimulatedPayment(sessionId: string, checkoutToken: string, outcome: SimulatedPaymentOutcome) {
  if (!publicPaymentSimulatorEnabled()) return { ok: false as const, code: "DISABLED" };
  const session = await db.publicPaymentSession.findUnique({ where: { id: sessionId }, include: { reservation: { include: { customer: true, unit: true, facility: true } } } });
  if (!session || tokenHash(checkoutToken) !== session.checkoutTokenHash) return { ok: false as const, code: "NOT_FOUND" };
  if (session.status !== "PENDING") {
    const followUp = session.status === "SUCCEEDED" ? await runSimulatedPaymentFollowUp(session.id) : null;
    return { ok: true as const, status: session.status, idempotent: true, followUpStatus: followUp?.status, signingUrl: followUp && "signingUrl" in followUp ? followUp.signingUrl : undefined, reference: session.reservation.publicReference, providerReference: session.providerReference };
  }
  const effectiveOutcome: SimulatedPaymentOutcome = session.expiresAt <= new Date() ? "TIMEOUT" : outcome;
  const status = effectiveOutcome === "SUCCESS" ? "SUCCEEDED" : effectiveOutcome;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.publicPaymentSession.update({ where: { id: session.id }, data: { status, failureCode: effectiveOutcome === "SUCCESS" ? null : effectiveOutcome, processedAt: now } });
    if (effectiveOutcome === "SUCCESS") {
      await tx.reservation.update({ where: { id: session.reservationId }, data: { holdExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } });
      if (session.reservation.leadId) await tx.lead.update({ where: { id: session.reservation.leadId }, data: { stage: "QUALIFIED" } });
    } else {
      const cancelled = await tx.reservation.updateMany({ where: { id: session.reservationId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      if (cancelled.count) await tx.unit.updateMany({ where: { id: session.reservation.unitId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
    }
    await tx.auditEvent.create({ data: { organisationId: session.reservation.customer.organisationId, facilityId: session.reservation.facilityId, action: `public_payment.simulator_${status.toLowerCase()}`, entityType: "PublicPaymentSession", entityId: session.id, requestId: session.idempotencyKey, after: { status, simulated: true } } });
  });
  const followUp = status === "SUCCEEDED" ? await runSimulatedPaymentFollowUp(session.id) : null;
  return { ok: true as const, status, idempotent: false, followUpStatus: followUp?.status, signingUrl: followUp && "signingUrl" in followUp ? followUp.signingUrl : undefined, reference: session.reservation.publicReference, providerReference: session.providerReference };
}
