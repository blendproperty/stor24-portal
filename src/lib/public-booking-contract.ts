import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const publicReservationSchema = z.object({
  facilitySlug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  unitId: z.string().trim().min(1).max(64),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  phone: z.string().trim().min(7).max(30),
  intendedMoveIn: z.coerce.date().optional(),
  communicationConsent: z.object({
    email: z.boolean().default(false),
    sms: z.boolean().default(false),
    phone: z.boolean().default(false),
    whatsapp: z.boolean().default(false),
  }).default({ email: false, sms: false, phone: false, whatsapp: false }),
  idempotencyKey: z.string().trim().min(16).max(100),
  websitePath: z.string().trim().max(300).optional(),
  honeypot: z.string().max(0).optional(),
});

export type PublicReservationInput = z.infer<typeof publicReservationSchema>;

export function secureKeyMatches(provided: string | null, configured: string | undefined) {
  if (!provided || !configured || configured.length < 32) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(configured).digest();
  return timingSafeEqual(left, right);
}

export function publicApiAuthorized(request: Request) {
  return secureKeyMatches(
    request.headers.get("x-stor24-public-key"),
    process.env.PUBLIC_BOOKING_API_KEY,
  );
}

export function publicAvailability(status: string) {
  return status === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE";
}

export function publicElementConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const config = value as Record<string, unknown>;
  return {
    ...(typeof config.mirrored === "boolean" ? { mirrored: config.mirrored } : {}),
    ...(typeof config.flippedVertical === "boolean" ? { flippedVertical: config.flippedVertical } : {}),
    ...(typeof config.variant === "string" && config.variant.length <= 40 ? { variant: config.variant } : {}),
  };
}

export function createPublicReference(now = new Date(), token = randomBytes(3).toString("hex")) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `ST24-${day}-${token.toUpperCase()}`;
}

export function reservationHoldHours(raw = process.env.PUBLIC_RESERVATION_HOLD_HOURS) {
  const parsed = Number(raw ?? 48);
  return Number.isFinite(parsed) ? Math.min(168, Math.max(1, Math.round(parsed))) : 48;
}
