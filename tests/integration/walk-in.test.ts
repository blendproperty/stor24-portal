import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { startWalkIn, redeemWalkIn, activeWalkIn, endWalkIn } from "../../src/lib/walk-in-service";
import { createPublicReservation } from "../../src/lib/public-booking-service";
test("isolated PostgreSQL tablet visit and booking boundaries", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED = "false";
  const key = randomUUID(), org = await db.organisation.create({ data: { name: "Walk-in CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key, publicSlug: key, publicBookingEnabled: true } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "CI staff", email: `${key}@example.invalid` } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "CI booking staff", permissions: ["reservations.manage"] } });
  await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: facility.id } });
  const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI", features: [] } });
  const units = await Promise.all(["1", "2"].map(number => db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number, monthlyRate: "100.00" } })));
  const prepare = async () => { const v = await startWalkIn(scope, facility.id); return { v, launch: new URL(v.launchUrl).hash.slice("#launch=".length) }; };
  const input = (token: string, unitId: string, idempotencyKey = randomUUID()) => ({ walkInToken: token, facilitySlug: key, unitId, firstName: "Synthetic", lastName: "Visitor", email: `${randomUUID()}@example.invalid`, phone: "0000000000", journey: "RENTAL" as const, intendedMoveIn: new Date(), idempotencyKey, communicationConsent: { email: false, sms: false, phone: false, whatsapp: false } });
  try {
    await t.test("staff store scope and one-use launch remain enforced under races", async () => {
      await assert.rejects(startWalkIn({ ...scope, facilityIds: [] }, facility.id), /FORBIDDEN/);
      const { launch } = await prepare();
      const results = await Promise.allSettled([redeemWalkIn(launch), redeemWalkIn(launch)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected").length, 1);
    });
    await t.test("launch expiry and live staff permission revocation block redemption", async () => {
      const { v, launch } = await prepare();
      await db.walkInVisit.update({ where: { id: v.id }, data: { launchExpiresAt: new Date(0) } });
      await assert.rejects(redeemWalkIn(launch), /WALK_IN_UNAVAILABLE/);
      const next = await prepare();
      await db.role.update({ where: { id: role.id }, data: { permissions: [] } });
      await assert.rejects(redeemWalkIn(next.launch), /WALK_IN_UNAVAILABLE/);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["reservations.manage"] } });
    });
    await t.test("one visit creates one walk-in booking, rollback preserves units, clearing retains the booking", async () => {
      const { v, launch } = await prepare(), { token } = await redeemWalkIn(launch);
      await assert.rejects(createPublicReservation({ ...input(token, units[0].id), facilitySlug: "other" }, "ci"), /WALK_IN_UNAVAILABLE/);
      await assert.rejects(createPublicReservation({ ...input(token, units[0].id), storagePackageId: "missing" }, "ci"), /UNIT_UNAVAILABLE/);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: units[0].id } })).status, "AVAILABLE");
      assert.equal((await activeWalkIn(token)).reservationId, null);
      const request = input(token, units[0].id), booking = await createPublicReservation(request, "ci");
      const visit = await activeWalkIn(token), reservation = await db.reservation.findUniqueOrThrow({ where: { id: visit.reservationId! }, include: { lead: true } });
      assert.equal(reservation.source, "PUBLIC_WALK_IN"); assert.equal(reservation.lead?.assignedToId, user.id);
      assert.equal((await createPublicReservation(request, "ci")).reference, booking.reference);
      await assert.rejects(createPublicReservation(input(token, units[1].id), "ci"), /WALK_IN_UNAVAILABLE/);
      assert.equal(await db.reservation.count({ where: { facilityId: facility.id } }), 1);
      await Promise.all([endWalkIn(token), endWalkIn(token)]);
      await assert.rejects(activeWalkIn(token), /WALK_IN_UNAVAILABLE/);
      assert.equal((await db.walkInVisit.findUniqueOrThrow({ where: { id: v.id } })).status, "CLOSED");
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, "ACTIVE");
      assert.equal(await db.auditEvent.count({ where: { entityId: v.id, action: "walk_in.tablet_cleared" } }), 1);
      assert.equal(await db.payment.count({ where: { account: { customer: { organisationId: org.id } } } }), 0);
      assert.equal(await db.tenancy.count({ where: { facilityId: facility.id } }), 0);
    });
  } finally { await db.$disconnect(); }
});
