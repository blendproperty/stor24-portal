import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicReference,
  publicAvailability,
  publicElementConfig,
  publicReservationSchema,
  publicReservationVerificationEnabled,
  reservationHoldHours,
  secureKeyMatches,
} from "../src/lib/public-booking-contract.ts";

test("public API keys fail closed and use exact matching", () => {
  const configured = "a-secure-test-key-that-is-at-least-32-characters";
  assert.equal(secureKeyMatches(configured, configured), true);
  assert.equal(secureKeyMatches(`${configured}-wrong`, configured), false);
  assert.equal(secureKeyMatches(null, configured), false);
  assert.equal(secureKeyMatches(configured, undefined), false);
  assert.equal(secureKeyMatches("short", "short"), false);
});

test("public reservations validate identity, consent and idempotency", () => {
  const parsed = publicReservationSchema.safeParse({
    facilitySlug: "midpoint",
    unitId: "unit-101",
    firstName: "Test",
    lastName: "Customer",
    email: "TEST@EXAMPLE.TEST",
    phone: "+27 10 000 0000",
    communicationConsent: { email: true, sms: false, phone: false },
    idempotencyKey: "website-test-request-0001",
    honeypot: "",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.email, "test@example.test");
  assert.equal(publicReservationSchema.safeParse({ facilitySlug: "midpoint", honeypot: "spam" }).success, false);
});

test("public map output collapses private status and config details", () => {
  assert.equal(publicAvailability("AVAILABLE"), "AVAILABLE");
  assert.equal(publicAvailability("OCCUPIED"), "UNAVAILABLE");
  assert.deepEqual(publicElementConfig({ mirrored: true, flippedVertical: false, variant: "return", internalNote: "private" }), {
    mirrored: true,
    flippedVertical: false,
    variant: "return",
  });
});

test("references are readable and reservation holds are bounded", () => {
  assert.equal(createPublicReference(new Date("2026-08-13T10:00:00.000Z"), "abc123"), "ST24-20260813-ABC123");
  assert.equal(reservationHoldHours("0"), 1);
  assert.equal(reservationHoldHours("1000"), 168);
  assert.equal(reservationHoldHours("invalid"), 24);
  assert.equal(publicReservationVerificationEnabled(undefined), false);
  assert.equal(publicReservationVerificationEnabled("false"), false);
  assert.equal(publicReservationVerificationEnabled("TRUE"), true);
});
