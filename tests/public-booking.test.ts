import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPublicReference,
  confirmedPublicHoldExpiry,
  publicAvailability,
  publicElementConfig,
  publicReservationSchema,
  publicReservationReferenceSchema,
  publicReservationVerificationEnabled,
  publicViewingWindowHours,
  reservationHoldHours,
  secureKeyMatches,
} from "../src/lib/public-booking-contract.ts";

const servicePath = new URL("../src/lib/public-booking-service.ts", import.meta.url);

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

test("reserve-to-view requires a viewing appointment", () => {
  const base = {
    facilitySlug: "midpoint", unitId: "unit-169", firstName: "View", lastName: "Customer",
    email: "view@example.test", phone: "+27817088120", idempotencyKey: "viewing-test-request-0001",
  };
  assert.equal(publicReservationSchema.safeParse({ ...base, journey: "VIEWING" }).success, false);
  assert.equal(publicReservationSchema.safeParse({ ...base, journey: "VIEWING", viewingAt: "2026-08-27T08:00:00.000Z" }).success, true);
  assert.equal(publicReservationSchema.parse(base).journey, "RENTAL");
});

test("viewing holds cover a later office-hours appointment", () => {
  const verified = new Date("2026-08-29T08:00:00.000Z");
  const mondayViewing = new Date("2026-08-31T08:00:00.000Z");
  assert.equal(confirmedPublicHoldExpiry(verified, "VIEWING", mondayViewing, 24).toISOString(), "2026-08-31T09:00:00.000Z");
});

test("viewing holds retain the normal 24-hour minimum", () => {
  const verified = new Date("2026-08-26T13:00:00.000Z");
  const nextMorning = new Date("2026-08-27T08:00:00.000Z");
  assert.equal(confirmedPublicHoldExpiry(verified, "VIEWING", nextMorning, 24).toISOString(), "2026-08-27T13:00:00.000Z");
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
  assert.equal(publicReservationReferenceSchema.safeParse("ST24-20260909-ABC123").success, true);
  assert.equal(publicReservationReferenceSchema.safeParse("ST24-T-cmtr4f9jx003w01tf6g2olg1k").success, true);
  assert.equal(publicReservationReferenceSchema.safeParse("not-a-stor24-reference").success, false);
  assert.equal(reservationHoldHours("0"), 1);
  assert.equal(reservationHoldHours("1000"), 168);
  assert.equal(reservationHoldHours("invalid"), 24);
  assert.equal(publicReservationVerificationEnabled(undefined), false);
  assert.equal(publicReservationVerificationEnabled("false"), false);
  assert.equal(publicReservationVerificationEnabled("TRUE"), true);
  assert.equal(publicViewingWindowHours("0"), 1);
  assert.equal(publicViewingWindowHours("100"), 72);
  assert.equal(publicViewingWindowHours("invalid"), 24);
});

// STOR24_OUTSTANDING_TASKS.md item #8 calls for a two-device race proof on the
// same available unit. Until now that invariant was only checked for the
// OFFLINE_PWA path (tests/offline-reservation-outbox.test.ts) — the public,
// customer-facing website path (`createPublicReservation`, the one Pinny and
// Feeza's UAT actually exercises) had no equivalent coverage at all. This is a
// source-contract + logic-invariant check, not a live-database proof: it
// confirms the real service still does the conditional-updateMany-under-
// transaction claim (which is what makes the claim atomic under PostgreSQL's
// default READ COMMITTED — the UPDATE re-evaluates its WHERE clause after
// acquiring the row lock, so a loser sees `count: 0` instead of overwriting
// the winner), and it exercises the same claim/loser logic concurrently in
// isolation. It does not replace running two real, simultaneous public
// bookings against the same unit on a real database, which remains open UAT.
test("public booking service atomically claims a unit before any other work", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.match(service, /db\.\$transaction/);
  assert.match(service, /unit\.status !== "AVAILABLE"/);
  assert.match(service, /tx\.unit\.updateMany/);
  assert.match(service, /where: \{ id: unit\.id, facilityId: facility\.id, status: "AVAILABLE" \}/);
  assert.match(service, /data: \{ status: "RESERVED" \}/);
  assert.match(service, /claimed\.count !== 1/);
  assert.match(service, /throw new PublicBookingError\("UNIT_UNAVAILABLE", 409\)/);
});

test("two simultaneous public bookings for the same unit allow exactly one atomic claim", async () => {
  // Models the exact guarantee `tx.unit.updateMany({ where: { ..., status: "AVAILABLE" }, data: { status: "RESERVED" } })`
  // gives under PostgreSQL: the second UPDATE to reach the row blocks until the
  // first transaction commits, then re-checks `status: "AVAILABLE"` against the
  // now-committed row and affects zero rows instead of clobbering the winner.
  let status: "AVAILABLE" | "RESERVED" = "AVAILABLE";
  let claimQueue: Promise<{ label: string; count: number }> = Promise.resolve({ label: "", count: 0 });
  const claim = (label: string) =>
    (claimQueue = claimQueue.then(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      if (status !== "AVAILABLE") return { label, count: 0 };
      status = "RESERVED";
      return { label, count: 1 };
    }));
  const [a, b] = await Promise.all([claim("Pinny"), claim("Feeza")]);
  const results = [a, b];
  assert.deepEqual(results.map((r) => r.count).sort(), [0, 1]);
  assert.equal(results.filter((r) => r.count === 1).length, 1);
  assert.equal(status, "RESERVED");
});
