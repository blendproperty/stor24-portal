import { LEASE_CLAUSE_KEYS } from "../../src/lib/lease-agreement-content";
import { readFile } from "node:fs/promises";
import { getUnitStatsByFacility } from "../../src/lib/dashboard-service";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { requireOperationalUnit, setFloorOperational } from "../../src/lib/floor-availability-service";
import { createReservation, moveIn, transfer, completeLeaseSigning, completeBlendSignEnvelope } from "../../src/lib/leasing-service";
import { createPublicReservation } from "../../src/lib/public-booking-service";
import { syncOfflineReservation } from "../../src/lib/offline-reservation-service";
import { confirmReservationMoveIn, getReservationMoveInReadiness } from "../../src/lib/reservation-move-in";
import { GET as publicFacility } from "../../src/app/api/public/v1/facilities/[slug]/route";
import { GET as publicFacilities } from "../../src/app/api/public/v1/facilities/route";

test("isolated PostgreSQL floor operating policy", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Floor CI only", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Midpoint fixture", code: key, publicSlug: key, publicBookingEnabled: true } });
  const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "CI staff" } });
  const customer = await db.customer.create({ data: { organisationId: org.id } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI unit" } });
  const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  const units = await Promise.all(["Ground Floor", "First Floor", "Second Floor"].map((floor, index) => db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: String(index), floor, monthlyRate: 100 } })));
  const maps = await Promise.all(units.map(unit => db.facilityMap.create({ data: { facilityId: facility.id, name: unit.floor!, elements: { create: { unitId: unit.id, type: "UNIT", x: 0, y: 0, width: 30, height: 30 } } } })));
  const first = units[1];
  const reserve = (unitId: string) => createReservation(scope, { facilityId: facility.id, customerId: customer.id, unitId, quotedRate: 100 });
  const toggle = (floor: string, operational: boolean, expectedOperational = !operational) => setFloorOperational(scope, { facilityId: facility.id, floor, operational, expectedOperational });
  try {
    await t.test("release configuration closes only the exact Midpoint store and retains an audit", async () => {
      const midpoint = await db.facility.create({ data: { organisationId: org.id, code: `seed-${key}`, name: "Store 1 - Midpoint", publicSlug: "midpoint" } });
      try {
        const sql = await readFile("prisma/migrations/20260923081000_midpoint_floor_closure/migration.sql", "utf8");
        await db.$executeRawUnsafe(sql);
        assert.deepEqual((await db.facility.findUniqueOrThrow({ where: { id: midpoint.id } })).closedFloors, ["first floor", "second floor"]);
        assert.deepEqual((await db.facility.findUniqueOrThrow({ where: { id: facility.id } })).closedFloors, []);
        assert.equal(await db.auditEvent.count({ where: { facilityId: midpoint.id, action: "facility.floor_availability_initialised" } }), 1);
      } finally {
        await db.auditEvent.deleteMany({ where: { facilityId: midpoint.id } });
        await db.facility.delete({ where: { id: midpoint.id } });
      }
    });
    await t.test("close first and second independently, persist and audit without changing units", async () => {
      await toggle("First Floor", false); await toggle("Second Floor", false);
      assert.deepEqual((await db.facility.findUniqueOrThrow({ where: { id: facility.id } })).closedFloors, ["first floor", "second floor"]);
      assert.equal(await db.unit.count({ where: { facilityId: facility.id, status: "AVAILABLE" } }), 3);
      assert.equal(await db.auditEvent.count({ where: { facilityId: facility.id, action: "facility.floor_availability_changed" } }), 2);
    });
    await t.test("public floor choices, mapped units and availability count exclude closed floors", async () => {
      process.env.PUBLIC_BOOKING_API_KEY = "floor-ci-only-not-a-production-key-123456789";
      const request = new Request("http://localhost/api", { headers: { "x-stor24-public-key": process.env.PUBLIC_BOOKING_API_KEY } });
      const detail = await (await publicFacility(request, { params: Promise.resolve({ slug: key }) })).json();
      assert.deepEqual(detail.data.units.map((u: { id: string }) => u.id), [units[0].id]);
      assert.deepEqual(detail.data.maps.map((m: { name: string }) => m.name), ["Ground Floor"]);
      assert.deepEqual(detail.data.comingSoonFloors, ["First Floor", "Second Floor"]);
      const list = await (await publicFacilities(request)).json();
      const stats = await getUnitStatsByFacility(scope);
      assert.equal(stats[0].available, 1); assert.equal(stats[0].service, 2); assert.equal(stats[0].total, 3);
      assert.equal(list.data.find((f: { slug: string }) => f.slug === key).availableUnitCount, 1);
      assert.equal((await publicFacility(new Request("http://localhost/api"), { params: Promise.resolve({ slug: key }) })).status, 401);
    });
    await t.test("coming-soon labels follow reopening and remain visible when every floor is closed", async () => {
      const request = new Request("http://localhost/api", { headers: { "x-stor24-public-key": process.env.PUBLIC_BOOKING_API_KEY! } });
      await toggle("First Floor", true);
      const reopened = await (await publicFacility(request, { params: Promise.resolve({ slug: key }) })).json();
      assert.deepEqual(reopened.data.comingSoonFloors, ["Second Floor"]);
      assert.ok(reopened.data.maps.some((map: { name: string }) => map.name === "First Floor"));
      await toggle("First Floor", false);
      await toggle("Ground Floor", false);
      const closed = await (await publicFacility(request, { params: Promise.resolve({ slug: key }) })).json();
      assert.deepEqual(closed.data.comingSoonFloors, ["Ground Floor", "First Floor", "Second Floor"]);
      assert.deepEqual(closed.data.maps, []);
      assert.deepEqual(closed.data.units, []);
      await toggle("Ground Floor", true);
    });
    await t.test("staff, direct public, move-in and stale offline submissions cannot allocate closed units", async () => {
      await assert.rejects(reserve(first.id), /FLOOR_NOT_OPERATIONAL/);
      await assert.rejects(moveIn(scope, { facilityId: facility.id, customerId: customer.id, unitId: first.id, startDate: new Date(), initialCharge: 0, accessState: "PENDING", paymentMethod: "EFT" }), /FLOOR_NOT_OPERATIONAL/);
      await assert.rejects(createPublicReservation({ facilitySlug: key, unitId: first.id, firstName: "Synthetic", lastName: "Customer", email: `${key}@example.invalid`, phone: "0000000000", journey: "RENTAL", idempotencyKey: randomUUID(), communicationConsent: { email: false, sms: false, phone: false, whatsapp: false } }, "ci"), /UNIT_UNAVAILABLE/);
      const lead = await db.lead.create({ data: { facilityId: facility.id, customerId: customer.id, source: "CI" } });
      await assert.rejects(syncOfflineReservation(scope, { facilityId: facility.id, unitId: first.id, customerId: customer.id, leadId: lead.id, submissionId: randomUUID(), leadSubmissionId: randomUUID(), deviceId: randomUUID(), capturedAt: new Date().toISOString(), quotedRate: 100, paymentMethod: "EFT" }), /FLOOR_NOT_OPERATIONAL/);
      assert.equal(await db.reservation.count({ where: { facilityId: facility.id } }), 0);
      assert.equal(await db.account.count({ where: { customerId: customer.id } }), 0);
      const groundReservation = await reserve(units[0].id);
      assert.ok(groundReservation.id);
    });
    await t.test("scope, unknown floor and stale writes fail without audit or configuration changes", async () => {
      const before = await db.auditEvent.count({ where: { facilityId: facility.id } });
      for (const wrongScope of [{ ...scope, organisationId: "other" }, { ...scope, facilityIds: [] }]) await assert.rejects(setFloorOperational(wrongScope, { facilityId: facility.id, floor: "First Floor", operational: true, expectedOperational: false }), /FORBIDDEN/);
      await assert.rejects(toggle("Roof", false), /NOT_FOUND/);
      await assert.rejects(toggle("First Floor", true, true), /FLOOR_STATE_CHANGED/);
      assert.equal(await db.auditEvent.count({ where: { facilityId: facility.id } }), before);
    });
    await t.test("reopen retains maintenance and reserved status; new units inherit closed-floor policy", async () => {
      await db.unit.update({ where: { id: first.id }, data: { status: "SERVICE" } });
      await toggle("First Floor", true);
      await assert.rejects(reserve(first.id), /CONFLICT/);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: first.id } })).status, "SERVICE");
      await db.unit.update({ where: { id: first.id }, data: { status: "AVAILABLE" } });
      const reservation = await reserve(first.id);
      await toggle("First Floor", false);
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, "ACTIVE");
      const readiness = await getReservationMoveInReadiness(scope, reservation.id);
      assert.ok(readiness.blockers.some(message => message.includes("floor is not operational")));
      await assert.rejects(confirmReservationMoveIn(scope, reservation.id), /FLOOR_NOT_OPERATIONAL/);
      const added = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "new", floor: "2nd Floor", monthlyRate: 100 } });
      await assert.rejects(reserve(added.id), /FLOOR_NOT_OPERATIONAL/);
    });
    await t.test("mapped units cannot bypass closure with a blank floor field", async () => {
      await db.unit.update({ where: { id: first.id }, data: { floor: null } });
      await assert.rejects(db.$transaction(tx => requireOperationalUnit(tx, facility.id, first.id)), /FLOOR_NOT_OPERATIONAL/);
      assert.ok(maps[1].id);
      await db.unit.update({ where: { id: first.id }, data: { floor: "First Floor" } });
    });
    await t.test("old signing links and signing callbacks cannot activate a closed-floor tenancy", async () => {
      const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `sign-${key}` } });
      const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "DRAFT", startDate: new Date(), paymentMethod: "EFT", occupancies: { create: { unitId: first.id, status: "PENDING", startDate: new Date(), monthlyRate: 100 } } } });
      const doc = await db.document.create({ data: { tenancyId: tenancy.id, type: "LEASE_AGREEMENT", status: "SENT", storageKey: "ci-only", signingToken: randomUUID(), externalId: randomUUID() } });
      await assert.rejects(completeLeaseSigning(doc.signingToken!, { signerName: "Synthetic Customer", initials: [...LEASE_CLAUSE_KEYS], signerIp: null, signerUserAgent: null }), /FLOOR_NOT_OPERATIONAL/);
      await assert.rejects(completeBlendSignEnvelope(doc.externalId!), /FLOOR_NOT_OPERATIONAL/);
      assert.equal((await db.tenancy.findUniqueOrThrow({ where: { id: tenancy.id } })).status, "DRAFT");
      assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "SENT");
    });
    await t.test("transfers cannot enter closed floors", async () => {
      const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
      const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date(), paymentMethod: "EFT", occupancies: { create: { unitId: units[0].id, status: "ACTIVE", startDate: new Date(), monthlyRate: 100 } } } });
      await assert.rejects(transfer(scope, { tenancyId: tenancy.id, toUnitId: units[2].id, effectiveAt: new Date() }), /FLOOR_NOT_OPERATIONAL/);
      assert.equal(await db.occupancy.count({ where: { tenancyId: tenancy.id, status: "ACTIVE", unitId: units[0].id } }), 1);
    });
    await t.test("a close that wins the facility lock blocks an already-started stale allocation", async () => {
      await toggle("Second Floor", true);
      let locked!: () => void;
      const lockAcquired = new Promise<void>(resolve => { locked = resolve; });
      let release!: () => void;
      const releaseLock = new Promise<void>(resolve => { release = resolve; });
      const closing = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${facility.id} FOR UPDATE`;
        await tx.facility.update({ where: { id: facility.id }, data: { closedFloors: ["first floor", "second floor"] } });
        locked(); await releaseLock;
      });
      await lockAcquired;
      const attempted = reserve(units[2].id);
      const rejected = assert.rejects(attempted, /FLOOR_NOT_OPERATIONAL/);
      release(); await closing; await rejected;
      assert.equal(await db.reservation.count({ where: { unitId: units[2].id } }), 0);
    });
  } finally { await db.$disconnect(); }
});
