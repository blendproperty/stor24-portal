import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { moveInBatch } from "../../src/lib/leasing-service";

test("multi-unit saves atomically, replays safely and rejects conflicts", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Batch test", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Test" } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Test", email: `${key}@example.invalid` } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Test", email: `${key}@example.invalid` } });
  const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "Test", features: [] } });
  const makeUnit = (number: string) => db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number, monthlyRate: 1000, status: "AVAILABLE" } });
  const [a, b, c] = await Promise.all([makeUnit("A"), makeUnit("B"), makeUnit("C")]);
  const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: true };
  const input = (unitId: string) => ({ unitId, facilityId: facility.id, customerId: customer.id, startDate: new Date("2026-12-01"), monthlyRate: 1000, initialCharge: 200, accessState: "PENDING", paymentMethod: "EFT" as const });
  try {
    const requestKey = randomUUID();
    const [first, replay] = await Promise.all([moveInBatch(scope, requestKey, [input(a.id), input(b.id)]), moveInBatch(scope, requestKey, [input(a.id), input(b.id)])]);
    assert.equal(first.id, replay.id);
    assert.equal(await db.tenancy.count({ where: { customerId: customer.id } }), 2);
    assert.equal(await db.ledgerEntry.count({ where: { account: { customerId: customer.id }, type: "CHARGE" } }), 2);
    assert.equal(await db.document.count({ where: { tenancy: { customerId: customer.id }, type: "LEASE_AGREEMENT", externalId: null } }), 2);
    await assert.rejects(moveInBatch(scope, requestKey, [input(a.id), { ...input(b.id), initialCharge: 300 }]), /CONFLICT/);
    await assert.rejects(moveInBatch(scope, randomUUID(), [input(a.id), input(c.id)]), /CONFLICT/);
    assert.equal((await db.unit.findUniqueOrThrow({ where: { id: c.id } })).status, "AVAILABLE");
    assert.equal(await db.tenancy.count({ where: { customerId: customer.id } }), 2);
    await assert.rejects(moveInBatch(scope, randomUUID(), [input(c.id), input(c.id)]), /CONFLICT/);
    const [d, e] = await Promise.all([makeUnit("D"), makeUnit("E")]);
    const sorted = [d, e].sort((x, y) => x.id.localeCompare(y.id));
    await db.unit.update({ where: { id: sorted[1].id }, data: { status: "RESERVED" } });
    await assert.rejects(moveInBatch(scope, randomUUID(), sorted.map(u => input(u.id))), /CONFLICT/);
    assert.equal((await db.unit.findUniqueOrThrow({ where: { id: sorted[0].id } })).status, "AVAILABLE");
    assert.equal(await db.tenancy.count({ where: { customerId: customer.id } }), 2);
    const outcomes = await Promise.allSettled([moveInBatch(scope, randomUUID(), [input(c.id)]), moveInBatch(scope, randomUUID(), [input(c.id)])]);
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    assert.equal(await db.tenancy.count({ where: { customerId: customer.id } }), 3);
    assert.equal(await db.ledgerEntry.count({ where: { account: { customerId: customer.id }, type: "CHARGE" } }), 3);
    await assert.rejects(moveInBatch({ ...scope, unrestrictedFacilities: false, facilityIds: [] }, requestKey, [input(a.id), input(b.id)]), /FORBIDDEN/);
  } finally { await db.$disconnect(); }
});
