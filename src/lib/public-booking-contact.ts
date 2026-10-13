import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { publicReservationVerificationEnabled } from "@/lib/public-booking-contract";
import { normalizeTwilioRecipient } from "@/lib/integrations/twilio-provider";
import { deliverEmailVerificationCode, deliverVerificationCode, emailVerificationHash, verificationHash } from "@/lib/public-booking-service";

export const contactCorrectionSchema = z.object({
  reference: z.string().trim().min(1).max(80),
  // The original random booking key proves possession of this browser's draft.
  bookingKey: z.uuid(),
}).and(z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("MOBILE"), value: z.string().trim().max(30).transform(normalizeTwilioRecipient).refine(value => value !== null, "Enter a valid mobile number.") }),
  z.object({ channel: z.literal("EMAIL"), value: z.string().trim().toLowerCase().max(254).pipe(z.email()) }),
]));
type Correction = z.infer<typeof contactCorrectionSchema>;
function sameKey(saved: string | null, supplied: string) {
  if (!saved) return false;
  return timingSafeEqual(createHash("sha256").update(saved).digest(), createHash("sha256").update(supplied).digest());
}

export async function correctPublicBookingContact(input: Correction) {
  if (!publicReservationVerificationEnabled()) return { ok: false as const, code: "UNAVAILABLE" };
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const changed = await db.$transaction(async tx => {
    // Serialise edits with challenge consumption and re-read all eligibility.
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "publicReference" = ${input.reference} FOR UPDATE`;
    const reservation = await tx.reservation.findUnique({ where: { publicReference: input.reference }, include: { customer: { include: { _count: { select: { reservations: true, tenancies: true } } } }, publicLease: true } });
    const now = new Date();
    if (!reservation || !sameKey(reservation.idempotencyKey, input.bookingKey) || reservation.status !== "ACTIVE" || !reservation.holdExpiresAt || reservation.holdExpiresAt <= now || reservation.publicLease || reservation.customer._count.reservations !== 1 || reservation.customer._count.tenancies !== 0 || reservation.customer.emailVerifiedAt || !["PUBLIC_WEBSITE", "PUBLIC_VIEWING", "PUBLIC_WALK_IN"].includes(reservation.source)) return null;
    const mobile = input.channel === "MOBILE";
    if (mobile ? Boolean(reservation.contactVerifiedAt || reservation.customer.phoneVerifiedAt || reservation.verificationAttempts >= 4) : (!reservation.contactVerifiedAt || reservation.journey !== "RENTAL" || reservation.verificationAttempts >= 9)) return null;
    // Corrections share the existing attempt budget and never extend the hold.
    const expiresAt = new Date(Math.min(now.getTime() + 10 * 60 * 1000, reservation.holdExpiresAt.getTime()));
    const attempt = reservation.verificationAttempts + 1;
    await tx.customer.update({ where: { id: reservation.customerId }, data: mobile ? { phone: input.value!, phoneVerifiedAt: null } : { email: input.value!, emailVerifiedAt: null } });
    await tx.reservation.update({ where: { id: reservation.id }, data: { verificationCodeHash: mobile ? verificationHash(reservation.id, code) : emailVerificationHash(reservation.id, code), verificationExpiresAt: expiresAt, verificationAttempts: attempt, identityAccessHash: null, identityAccessExpiresAt: null } });
    await tx.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: "public_reservation.contact_corrected", entityType: "Reservation", entityId: reservation.id, after: { channel: input.channel, attempt } } });
    return { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, customerId: reservation.customerId, attempt, expiresAt };
  });
  if (!changed) return { ok: false as const, code: "UNAVAILABLE" };
  const context = { ...changed, code, idempotencyKey: `${input.bookingKey}:CONTACT_CORRECTION:${changed.attempt}` };
  let delivery;
  try {
    delivery = input.channel === "MOBILE" ? await deliverVerificationCode({ ...context, phone: input.value! }) : await deliverEmailVerificationCode({ ...context, email: input.value! });
  } catch { delivery = { ok: false as const }; }
  return { ok: true as const, saved: true, delivered: delivery.ok, value: input.value!, verificationChannel: input.channel === "EMAIL" ? "EMAIL" : delivery.ok && "channel" in delivery ? delivery.channel : null, verificationExpiresAt: changed.expiresAt.toISOString() };
}
