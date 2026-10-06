import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { createPublicReservation } from "../../src/lib/public-booking-service";
import { GET as inventory } from "../../src/app/api/public/v1/facilities/[slug]/route";

test("isolated shared Micro Warehousing inventory and concurrent allocation", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.PUBLIC_BOOKING_API_KEY = "isolated-ci-product-test-key-123456789";
  process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED = "false";
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "MW isolated fixture", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "MW fixture", code: key, publicSlug: key, publicBookingEnabled: true } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "Shared", useTypes: ["STORAGE", "MICRO_WAREHOUSE"] } });
  const shared = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "G1", floor: "Ground Floor", monthlyRate: 100 } });
  const storage = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "G2", floor: "Ground Floor", monthlyRate: 100, useTypesOverride: ["STORAGE"] } });
  const upper = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "F1", floor: "First Floor", monthlyRate: 100 } });
  await db.facilityMap.create({ data: { facilityId: facility.id, name: "Ground Floor", elements: { create: [shared, storage].map((u, i) => ({ unitId: u.id, type: "UNIT" as const, x: i * 30, y: 0, width: 30, height: 30 })) } } });
  await db.facilityMap.create({ data: { facilityId: facility.id, name: "First Floor", elements: { create: { unitId: upper.id, type: "UNIT", x: 0, y: 0, width: 30, height: 30 } } } });
  const request = (product: string) => new Request(`https://fixture/api?useType=${product}`, { headers: { "x-stor24-public-key": process.env.PUBLIC_BOOKING_API_KEY! } });
  const payload = (unitId: string, productLine: "STORAGE" | "MICRO_WAREHOUSE") => ({ facilitySlug: key, unitId, productLine, firstName: "CI", lastName: "Only", email: `${randomUUID()}@example.invalid`, phone: "0000000000", journey: "RENTAL" as const, idempotencyKey: randomUUID(), communicationConsent: { email: false, sms: false, phone: false, whatsapp: false }, businessDetails: { companyName: "CI business" } });
  try {
    const before = await (await inventory(request("MICRO_WAREHOUSE"), { params: Promise.resolve({ slug: key }) })).json();
    assert.deepEqual(before.data.units.map((u: { id: string }) => u.id), [shared.id]);
    assert.deepEqual(before.data.maps.map((m: { name: string }) => m.name), ["Ground Floor"]);
    assert.deepEqual(before.data.maps[0].elements.map((e: { unit: { id: string } }) => e.unit.id), [shared.id]);
    await assert.rejects(createPublicReservation(payload(storage.id, "MICRO_WAREHOUSE"), "ci"), /UNIT_UNAVAILABLE/);
    await assert.rejects(createPublicReservation(payload(upper.id, "MICRO_WAREHOUSE"), "ci"), /UNIT_UNAVAILABLE/);
    assert.equal(await db.reservation.count({ where: { facilityId: facility.id } }), 0);
    const outcomes = await Promise.allSettled([createPublicReservation(payload(shared.id, "STORAGE"), "ci"), createPublicReservation(payload(shared.id, "MICRO_WAREHOUSE"), "ci")]);
    assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(await db.reservation.count({ where: { unitId: shared.id, status: "ACTIVE" } }), 1);
    assert.equal((await db.unit.findUniqueOrThrow({ where: { id: shared.id } })).status, "RESERVED");
    for (const product of ["STORAGE", "MICRO_WAREHOUSE"]) {
      const after = await (await inventory(request(product), { params: Promise.resolve({ slug: key }) })).json();
      assert.equal(after.data.units.find((u: { id: string }) => u.id === shared.id).availability, "UNAVAILABLE");
    }
  } finally { await db.$disconnect(); }
});
