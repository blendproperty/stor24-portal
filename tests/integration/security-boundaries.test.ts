import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { requireFacility } from "../../src/lib/scope";
import { createCustomer, createLead, requireLeasingCustomer } from "../../src/lib/leasing-service";
import { listIdentityLinks } from "../../src/lib/mel-integration-status-service";

test("isolated PostgreSQL security boundaries and safe staff projections", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Security CI", slug: key } });
  const other = await db.organisation.create({ data: { name: "Other security CI", slug: `${key}-other` } });
  const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "Synthetic reviewer", passwordHash: "synthetic-not-a-real-password-hash" } });
  const a = await db.facility.create({ data: { organisationId: org.id, code: "a", name: "A" } });
  const b = await db.facility.create({ data: { organisationId: org.id, code: "b", name: "B" } });
  const foreign = await db.facility.create({ data: { organisationId: other.id, code: "foreign", name: "Foreign" } });
  const scope = { userId: user.id, organisationId: org.id, facilityIds: [a.id], unrestrictedFacilities: false };
  try {
    await t.test("SQL intersects requested ID with assigned facility and organisation", async () => {
      assert.equal((await requireFacility(scope, a.id)).id, a.id);
      for (const id of [b.id, foreign.id]) await assert.rejects(requireFacility(scope, id), /FORBIDDEN/);
      await assert.rejects(requireFacility({ ...scope, facilityIds: [] }, a.id), /FORBIDDEN/);
      assert.equal((await requireFacility({ ...scope, unrestrictedFacilities: true }, b.id)).id, b.id);
      await assert.rejects(requireFacility({ ...scope, unrestrictedFacilities: true }, foreign.id), /FORBIDDEN/);
    });
    const own = await createCustomer(scope, { firstName: "Own", lastName: "Fixture" });
    const unrelated = await db.customer.create({ data: { organisationId: org.id, firstName: "Other", lastName: "Fixture", leads: { create: { facilityId: b.id, source: "CI" } } } });
    await t.test("creator can link a new customer but cannot adopt another facility's customer", async () => {
      assert.equal((await requireLeasingCustomer(scope, own.id)).id, own.id);
      await createLead(scope, { facilityId: a.id, customerId: own.id, source: "CI" });
      assert.equal((await requireLeasingCustomer(scope, own.id)).id, own.id);
      await assert.rejects(requireLeasingCustomer(scope, unrelated.id), /FORBIDDEN/);
      await assert.rejects(createLead(scope, { facilityId: a.id, customerId: unrelated.id, source: "CI" }), /FORBIDDEN/);
    });
    await t.test("populated status rows omit password hashes and other-facility customers", async () => {
      for (const customerId of [own.id, unrelated.id]) await db.integrationIdentityLink.create({ data: { organisationId: org.id, customerId, resolvedById: user.id } });
      const rows = await listIdentityLinks(scope);
      assert.equal(rows.length, 1); assert.equal(rows[0].customerId, own.id);
      assert.deepEqual(rows[0].resolvedBy, { id: user.id, name: user.name });
      assert.equal(JSON.stringify(rows).includes("passwordHash"), false);
      assert.equal(JSON.stringify(rows).includes("synthetic-not-a-real-password-hash"), false);
    });
  } finally { await db.$disconnect(); }
});
