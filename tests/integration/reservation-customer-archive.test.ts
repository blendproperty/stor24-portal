import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { getTestCustomerCleanupPreview } from "../../src/lib/uat-reset-service";
import { setReservationCustomerArchive } from "../../src/lib/reservation-customer-archive";

test("archive and restore preserve linked history and reject stale or foreign selections", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Archive CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "CI" } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "CI", email: `${key}@example.invalid` } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Test" } });
  const genuine = await db.customer.create({ data: { organisationId: org.id, firstName: "Genuine" } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI", features: [] } });
  const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: key, monthlyRate: 100 } });
  const lead = await db.lead.create({ data: { facilityId: facility.id, customerId: customer.id, source: "CI" } });
  const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, leadId: lead.id, quotedRate: 100 } });
  const note = await db.customerNote.create({ data: { organisationId: org.id, customerId: customer.id, facilityId: facility.id, authorId: user.id, authorName: "CI", category: "GENERAL", body: "Keep", requestKey: key } });
  const ids = [customer.id];
  const base = { organisationId: org.id, actorId: user.id, ids };
  try {
    const preview = await getTestCustomerCleanupPreview(org.id, ids);
    await assert.rejects(setReservationCustomerArchive({ ...base, fingerprint: "0".repeat(64), archived: true }), /CONFLICT/);
    await assert.rejects(setReservationCustomerArchive({ ...base, ids: ["foreign"], fingerprint: preview.fingerprint, archived: true }), /NOT_FOUND/);
    await setReservationCustomerArchive({ ...base, fingerprint: preview.fingerprint, archived: true });
    assert.equal(await db.customer.count({ where: { organisationId: org.id, reservationArchivedAt: null } }), 1);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: genuine.id } })).reservationArchivedAt, null);
    assert.equal((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).customerId, customer.id);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).customerId, customer.id);
    assert.equal((await db.customerNote.findUniqueOrThrow({ where: { id: note.id } })).body, "Keep");
    const restore = await getTestCustomerCleanupPreview(org.id, ids);
    await setReservationCustomerArchive({ ...base, fingerprint: restore.fingerprint, archived: false });
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).reservationArchivedAt, null);
    assert.equal(await db.auditEvent.count({ where: { organisationId: org.id, entityId: customer.id, action: { in: ["customer.reservation_archived", "customer.reservation_restored"] } } }), 2);
  } finally { await db.$disconnect(); }
});
