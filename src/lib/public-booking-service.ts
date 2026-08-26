import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  createPublicReference,
  publicReservationVerificationEnabled,
  reservationHoldHours,
  type PublicReservationInput,
} from "@/lib/public-booking-contract";
import { notifyReservationConfirmed } from "@/lib/notifications";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { TwilioSmsProvider, TwilioWhatsAppProvider, normalizeTwilioRecipient } from "@/lib/integrations/twilio-provider";

export class PublicBookingError extends Error {
  constructor(
    public readonly code: "FACILITY_NOT_FOUND" | "UNIT_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT",
    public readonly status: 404 | 409,
  ) {
    super(code);
  }
}

function reservationResult(reservation: {
  publicReference: string | null;
  status: string;
  holdExpiresAt: Date | null;
  quotedRate: { toString(): string };
  unit: { number: string; unitType: { name: string; areaSqMetres: { toString(): string } | null } };
  facility: { name: string; publicSlug: string | null };
}) {
  return {
    reference: reservation.publicReference,
    status: reservation.status,
    holdExpiresAt: reservation.holdExpiresAt?.toISOString() ?? null,
    quotedMonthlyRateZar: Number(reservation.quotedRate.toString()),
    facility: { name: reservation.facility.name, slug: reservation.facility.publicSlug },
    unit: {
      number: reservation.unit.number,
      type: reservation.unit.unitType.name,
      areaSqMetres: reservation.unit.unitType.areaSqMetres
        ? Number(reservation.unit.unitType.areaSqMetres.toString())
        : null,
    },
  };
}

const reservationInclude = {
  facility: { select: { name: true, publicSlug: true } },
  unit: { select: { number: true, unitType: { select: { name: true, areaSqMetres: true } } } },
} satisfies Prisma.ReservationInclude;

function verificationHash(reservationId: string, code: string) {
  return createHash("sha256").update(`${process.env.PUBLIC_BOOKING_API_KEY}:${reservationId}:${code}`).digest("hex");
}

const verificationWindowMs = 10 * 60 * 1000;

async function deliverVerificationCode(input: { code: string; phone: string; organisationId: string; facilityId: string; idempotencyKey: string }) {
  const context = { organisationId: input.organisationId, facilityId: input.facilityId, idempotencyKey: input.idempotencyKey };
  const contentSid = process.env.TWILIO_WHATSAPP_VERIFICATION_SID ?? "";
  if (contentSid) {
    const whatsApp = await new TwilioWhatsAppProvider().sendTemplate(input.phone, contentSid, { "1": input.code }, context);
    if (whatsApp.ok) return { ok: true as const, channel: "WHATSAPP" as const };
  }
  const sms = await new TwilioSmsProvider().send(
    { recipient: input.phone, body: `Stor24 verification code: ${input.code}. It expires in 10 minutes. Do not share this code.` },
    context,
  );
  return sms.ok ? { ok: true as const, channel: "SMS" as const } : { ok: false as const };
}

export async function releaseExpiredPublicReservations(now = new Date()) {
  const expired = await db.reservation.findMany({
    where: { status: "ACTIVE", source: "PUBLIC_WEBSITE", holdExpiresAt: { lte: now } },
    select: { id: true, unitId: true },
    take: 100,
  });
  for (const item of expired) {
    await db.$transaction(async (tx) => {
      const cancelled = await tx.reservation.updateMany({ where: { id: item.id, status: "ACTIVE", holdExpiresAt: { lte: now } }, data: { status: "CANCELLED", verificationCodeHash: null, verificationExpiresAt: null } });
      if (cancelled.count === 1) await tx.unit.updateMany({ where: { id: item.unitId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
    });
  }
  return expired.length;
}

export async function createPublicReservation(input: PublicReservationInput, ipHash: string) {
  await releaseExpiredPublicReservations();
  const verificationEnabled = publicReservationVerificationEnabled();
  const existing = await db.reservation.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: reservationInclude,
  });
  if (existing) {
    if (existing.facility.publicSlug !== input.facilitySlug)
      throw new PublicBookingError("IDEMPOTENCY_CONFLICT", 409);
    return {
      ...reservationResult(existing),
      verificationRequired: Boolean(existing.verificationCodeHash && !existing.contactVerifiedAt),
      verificationExpiresAt: existing.verificationExpiresAt?.toISOString() ?? null,
    };
  }

  const facility = await db.facility.findFirst({
    where: { publicSlug: input.facilitySlug, publicBookingEnabled: true, active: true },
    select: { id: true, organisationId: true, name: true },
  });
  if (!facility) throw new PublicBookingError("FACILITY_NOT_FOUND", 404);
  const verificationCode = verificationEnabled ? randomInt(0, 1_000_000).toString().padStart(6, "0") : "";

  try {
    const reservation = await db.$transaction(async (tx) => {
      const unit = await tx.unit.findFirst({
        where: { id: input.unitId, facilityId: facility.id },
        include: { unitType: true },
      });
      if (!unit || unit.status !== "AVAILABLE")
        throw new PublicBookingError("UNIT_UNAVAILABLE", 409);

      const claimed = await tx.unit.updateMany({
        where: { id: unit.id, facilityId: facility.id, status: "AVAILABLE" },
        data: { status: "RESERVED" },
      });
      if (claimed.count !== 1) throw new PublicBookingError("UNIT_UNAVAILABLE", 409);

      const consent = {
        ...input.communicationConsent,
        recordedAt: new Date().toISOString(),
        source: "PUBLIC_WEBSITE",
      };
      let customer = verificationEnabled ? null : await tx.customer.findFirst({ where: { organisationId: facility.organisationId, email: { equals: input.email, mode: "insensitive" } }, orderBy: { updatedAt: "desc" } });
      if (!customer) customer = await tx.customer.create({ data: { organisationId: facility.organisationId, type: "INDIVIDUAL", firstName: input.firstName, lastName: input.lastName, email: input.email, phone: normalizeTwilioRecipient(input.phone) ?? input.phone, communicationConsent: consent } });

      const lead = await tx.lead.create({
        data: {
          facilityId: facility.id,
          customerId: customer.id,
          desiredUnitTypeId: unit.unitTypeId,
          stage: "RESERVED",
          source: "PUBLIC_WEBSITE",
          expectedMoveIn: input.intendedMoveIn,
          notes: input.websitePath ? `Website path: ${input.websitePath}` : undefined,
        },
      });
      const holdExpiresAt = new Date(Date.now() + (verificationEnabled ? verificationWindowMs : reservationHoldHours() * 60 * 60 * 1000));
      const created = await tx.reservation.create({
        data: {
          facilityId: facility.id,
          customerId: customer.id,
          leadId: lead.id,
          unitId: unit.id,
          quotedRate: unit.monthlyRate,
          holdExpiresAt,
          intendedMoveIn: input.intendedMoveIn,
          verificationExpiresAt: verificationEnabled ? holdExpiresAt : null,
          verificationCodeHash: verificationEnabled ? "PENDING" : null,
          publicReference: createPublicReference(),
          idempotencyKey: input.idempotencyKey,
          source: "PUBLIC_WEBSITE",
        },
        include: reservationInclude,
      });
      if (verificationEnabled) await tx.reservation.update({ where: { id: created.id }, data: { verificationCodeHash: verificationHash(created.id, verificationCode) } });
      await tx.auditEvent.create({
        data: {
          organisationId: facility.organisationId,
          facilityId: facility.id,
          action: "public_reservation.created",
          entityType: "Reservation",
          entityId: created.id,
          requestId: input.idempotencyKey,
          ipHash,
          after: {
            source: "PUBLIC_WEBSITE",
            unitId: unit.id,
            leadId: lead.id,
            holdExpiresAt: holdExpiresAt.toISOString(),
          },
        },
      });
      return { created, customerId: customer.id };
    });

    const { created, customerId } = reservation;

    if (!verificationEnabled) {
      await notifyReservationConfirmed({ organisationId: facility.organisationId, facilityId: facility.id, customerId, idempotencyKey: input.idempotencyKey, consent: input.communicationConsent, to: { email: input.email, phone: input.phone }, variables: { firstName: input.firstName, facilityName: created.facility.name, unitNumber: created.unit.number, monthlyRateZar: created.quotedRate.toString(), holdExpiresAt: created.holdExpiresAt?.toISOString() ?? "", intendedMoveIn: created.intendedMoveIn ? created.intendedMoveIn.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }) : "To be confirmed", reference: created.publicReference ?? "" } });
      return { ...reservationResult(created), verificationRequired: false };
    }
    const otp = await deliverVerificationCode({ code: verificationCode, phone: input.phone, organisationId: facility.organisationId, facilityId: facility.id, idempotencyKey: `${input.idempotencyKey}:VERIFY` });
    if (!otp.ok) {
      await db.$transaction([db.reservation.update({ where: { id: created.id }, data: { status: "CANCELLED" } }), db.unit.update({ where: { id: input.unitId }, data: { status: "AVAILABLE" } })]);
      throw new Error("OTP_DELIVERY_FAILED");
    }
    await db.auditEvent.create({ data: { organisationId: facility.organisationId, facilityId: facility.id, action: "public_reservation.verification_sent", entityType: "Reservation", entityId: created.id, requestId: input.idempotencyKey, after: { channel: otp.channel, expiresAt: created.verificationExpiresAt?.toISOString() } } });
    return { ...reservationResult(created), verificationRequired: true, verificationChannel: otp.channel, verificationExpiresAt: created.verificationExpiresAt?.toISOString() ?? null };
  } catch (error) {
    if (error instanceof PublicBookingError) throw error;
    if ((error as { code?: string }).code === "P2002") {
      const duplicate = await db.reservation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: reservationInclude,
      });
      if (duplicate && duplicate.facility.publicSlug === input.facilitySlug)
        return reservationResult(duplicate);
      throw new PublicBookingError("IDEMPOTENCY_CONFLICT", 409);
    }
    throw error;
  }
}

export async function verifyPublicReservation(reference: string, code: string) {
  if (!publicReservationVerificationEnabled()) return { ok: false as const, code: "DISABLED" };
  const reservation = await db.reservation.findUnique({ where: { publicReference: reference }, include: { ...reservationInclude, customer: true } });
  if (!reservation || reservation.status !== "ACTIVE" || reservation.contactVerifiedAt) return { ok: false as const, code: "NOT_FOUND" };
  if (!reservation.verificationExpiresAt || reservation.verificationExpiresAt < new Date() || reservation.verificationAttempts >= 5) return { ok: false as const, code: "EXPIRED" };
  const expected = Buffer.from(reservation.verificationCodeHash ?? "", "hex");
  const actual = Buffer.from(verificationHash(reservation.id, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await db.reservation.update({ where: { id: reservation.id }, data: { verificationAttempts: { increment: 1 } } });
    return { ok: false as const, code: "INVALID_CODE" };
  }
  const verifiedAt = new Date();
  const holdExpiresAt = new Date(verifiedAt.getTime() + reservationHoldHours() * 60 * 60 * 1000);
  const updated = await db.$transaction(async (tx) => {
    const item = await tx.reservation.update({ where: { id: reservation.id }, data: { contactVerifiedAt: verifiedAt, holdExpiresAt, verificationCodeHash: null, verificationExpiresAt: null }, include: reservationInclude });
    await tx.customer.update({ where: { id: reservation.customerId }, data: { phoneVerifiedAt: verifiedAt } });
    await tx.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: "public_reservation.contact_verified", entityType: "Reservation", entityId: reservation.id, requestId: reservation.idempotencyKey, after: { verifiedAt: verifiedAt.toISOString(), holdExpiresAt: holdExpiresAt.toISOString() } } });
    return item;
  });
  await notifyReservationConfirmed({ organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, customerId: reservation.customerId, idempotencyKey: reservation.idempotencyKey ?? reservation.id, consent: reservation.customer.communicationConsent as { email: boolean; sms: boolean; phone: boolean; whatsapp?: boolean }, to: { email: reservation.customer.email ?? "", phone: reservation.customer.phone ?? "" }, variables: { firstName: reservation.customer.firstName ?? "customer", facilityName: reservation.facility.name, unitNumber: reservation.unit.number, monthlyRateZar: reservation.quotedRate.toString(), holdExpiresAt: holdExpiresAt.toISOString(), intendedMoveIn: reservation.intendedMoveIn ? reservation.intendedMoveIn.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }) : "To be confirmed", reference } });
  return { ok: true as const, ...reservationResult(updated) };
}

export async function resendPublicReservationVerification(reference: string) {
  if (!publicReservationVerificationEnabled()) return { ok: false as const, code: "DISABLED" };
  const reservation = await db.reservation.findUnique({ where: { publicReference: reference }, include: { customer: true } });
  if (!reservation || reservation.status !== "ACTIVE" || reservation.contactVerifiedAt || reservation.verificationAttempts >= 5) return { ok: false as const, code: "NOT_FOUND" };
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const verificationExpiresAt = new Date(Date.now() + verificationWindowMs);
  await db.reservation.update({ where: { id: reservation.id }, data: { verificationCodeHash: verificationHash(reservation.id, code), verificationExpiresAt, holdExpiresAt: verificationExpiresAt, verificationAttempts: { increment: 1 } } });
  const result = await deliverVerificationCode({ code, phone: reservation.customer.phone ?? "", organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, idempotencyKey: `${reservation.idempotencyKey ?? reservation.id}:VERIFY:${reservation.verificationAttempts + 1}` });
  await db.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: result.ok ? "public_reservation.verification_resent" : "public_reservation.verification_resend_failed", entityType: "Reservation", entityId: reservation.id, requestId: reservation.idempotencyKey, after: { channel: result.ok ? result.channel : null, expiresAt: verificationExpiresAt.toISOString() } } });
  return result.ok ? { ok: true as const, verificationChannel: result.channel, verificationExpiresAt: verificationExpiresAt.toISOString() } : { ok: false as const, code: "DELIVERY_FAILED" };
}
