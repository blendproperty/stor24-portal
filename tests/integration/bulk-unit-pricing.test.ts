import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { bulkUnitPricing } from "../../src/lib/bulk-unit-pricing-service";
import { protectUnitStructure } from "../../src/lib/inventory-structure-service";

test("isolated PostgreSQL bulk rates preserve unselected units, bookings and audit atomicity", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Rate CI", slug: key } });
  let constrained = false;
  try {
    const actor = await db.user.create({ data: { organisationId: org.id, name: "CI", email: `${key}@example.invalid` } });
    const store = await db.facility.create({ data: { organisationId: org.id, name: "Rate CI", code: key } });
    const other = await db.facility.create({ data: { organisationId: org.id, name: "Other", code: `${key}-b` } });
    const type = await db.unitType.create({ data: { facilityId: store.id, name: "5 sqm", areaSqMetres: 5 } });
    const units = await Promise.all(["A1", "A2", "A3"].map(number => db.unit.create({ data: { facilityId: store.id, unitTypeId: type.id, number, monthlyRate: 100 } })));
    const customer = await db.customer.create({ data: { organisationId: org.id } });
    const booking = await db.reservation.create({ data: { facilityId: store.id, unitId: units[0].id, customerId: customer.id, quotedRate: 80 } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key, balance: 137 } });
    const tenancy = await db.tenancy.create({ data: { facilityId: store.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2026-10-01T00:00:00Z") } });
    const occupancy = await db.occupancy.create({ data: { tenancyId: tenancy.id, unitId: units[1].id, status: "ACTIVE", startDate: tenancy.startDate, monthlyRate: 75 } });
    const scope = { organisationId: org.id, userId: actor.id, unrestrictedFacilities: false, facilityIds: [store.id] };
    const input = { facilityId: store.id, unitIds: units.slice(0, 2).map(u => u.id), mode: "PERCENT" as const, value: 10, action: "preview" as "preview" | "apply" };
    const preview = await bulkUnitPricing(scope, input);
    assert.equal(await db.auditEvent.count({ where: { facilityId: store.id } }), 0);
    assert.equal(Number((await db.unit.findUniqueOrThrow({ where: { id: units[0].id } })).monthlyRate), 100);
    await assert.rejects(bulkUnitPricing({ ...scope, facilityIds: [] }, input), /FORBIDDEN/);
    await assert.rejects(bulkUnitPricing(scope, { ...input, facilityId: other.id }), /FORBIDDEN/);
    await assert.rejects(bulkUnitPricing(scope, { ...input, unitIds: [units[0].id, "missing"] }), /FORBIDDEN/);
    await db.unit.update({ where: { id: units[0].id }, data: { monthlyRate: 101 } });
    await assert.rejects(bulkUnitPricing(scope, { ...input, action: "apply", expectedToken: preview.token }), /STALE/);
    const current = await bulkUnitPricing(scope, input);
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_bulk_rate_audit_failure CHECK (false) NOT VALID'); constrained = true;
    await assert.rejects(bulkUnitPricing(scope, { ...input, action: "apply", expectedToken: current.token }));
    assert.equal(Number((await db.unit.findUniqueOrThrow({ where: { id: units[1].id } })).monthlyRate), 100);
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_bulk_rate_audit_failure'); constrained = false;
    const outcomes = await Promise.allSettled([1, 2].map(() => bulkUnitPricing(scope, { ...input, action: "apply", expectedToken: current.token })));
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
    const rates = await db.unit.findMany({ where: { facilityId: store.id }, orderBy: { number: "asc" } });
    assert.deepEqual(rates.map(u => Number(u.monthlyRate)), [111.1, 110, 100]);
    assert.equal(Number((await db.reservation.findUniqueOrThrow({ where: { id: booking.id } })).quotedRate), 80);
    assert.deepEqual(await db.tenancy.findUniqueOrThrow({ where: { id: tenancy.id } }), tenancy);
    assert.deepEqual(await db.occupancy.findUniqueOrThrow({ where: { id: occupancy.id } }), occupancy);
    assert.equal(Number((await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance), 137);
    for (const status of ["PENDING", "ACTIVE", "NOTICE_GIVEN", "TRANSFERRING"] as const) {
      await db.occupancy.update({ where: { id: occupancy.id }, data: { status } });
      await assert.rejects(db.$transaction(tx => protectUnitStructure(tx, store.id, units[1].id, { floor: "Second" })), /PROTECTED/);
    }
    const audits = await db.auditEvent.findMany({ where: { action: "units.rates.adjusted", facilityId: store.id } });
    assert.equal(audits.length, 1); assert.equal(audits[0].actorId, actor.id);
  } finally {
    if (constrained) await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_bulk_rate_audit_failure');
    try {
      await db.tenancy.deleteMany({ where: { facility: { organisationId: org.id } } });
      await db.account.deleteMany({ where: { customer: { organisationId: org.id } } });
      await db.organisation.delete({ where: { id: org.id } });
    } finally { await db.$disconnect(); }
  }
});
