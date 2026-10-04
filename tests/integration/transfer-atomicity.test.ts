import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { transfer } from "../../src/lib/leasing-service";
import type { Prisma } from "../../src/generated/prisma/client";

test("isolated PostgreSQL transfers preserve one active occupancy and audit atomicity", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Transfer CI only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic transfer store", code: key } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic operator", email: `${key}@example.invalid` } });
    const customer = await db.customer.create({ data: { organisationId: org.id } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: "Synthetic unit" } });
    const units = await Promise.all(["source", "target-a", "target-b"].map(number => db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number, monthlyRate: 100, status: number === "source" ? "OCCUPIED" : "AVAILABLE" } })));
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2026-01-01"), occupancies: { create: { unitId: units[0].id, status: "ACTIVE", startDate: new Date("2026-01-01"), monthlyRate: 100 } } } });
    const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    return { org, tenancy, units, scope };
  }
  try {
    await t.test("different destinations racing from the same source commit only one transfer", async () => {
      const f = await fixture();
      const original = db.$transaction;
      const transaction = db.$transaction.bind(db);
      let arrivals = 0, release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      // Only coordinate timing; every query and transaction uses actual PostgreSQL.
      db.$transaction = (async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => work(new Proxy(tx, { get(target, property) {
        if (property === "tenancy") return { ...target.tenancy, findFirst: async (args: Prisma.TenancyFindFirstArgs) => {
          const value = await target.tenancy.findFirst(args);
          arrivals++; if (arrivals === 2) release(); await barrier; return value;
        } };
        return Reflect.get(target, property);
      } })), { timeout: 15_000 })) as typeof db.$transaction;
      let results: PromiseSettledResult<unknown>[];
      try {
        results = await Promise.allSettled(f.units.slice(1).map(unit => transfer(f.scope, { tenancyId: f.tenancy.id, toUnitId: unit.id, effectiveAt: new Date("2026-02-01") })));
      } finally { db.$transaction = original; }
      assert.equal(arrivals, 2);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
      assert.match(String(rejected.reason), /CONFLICT/);
      const active = await db.occupancy.findMany({ where: { tenancyId: f.tenancy.id, status: "ACTIVE" } });
      assert.equal(active.length, 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "tenancy.transferred" } }), 1);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.units[0].id } })).status, "AVAILABLE");
      const losingUnit = f.units.slice(1).find(unit => unit.id !== active[0].unitId)!;
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: losingUnit.id } })).status, "AVAILABLE");
      // A subsequent deliberate transfer from the newly current occupancy remains supported.
      await transfer(f.scope, { tenancyId: f.tenancy.id, toUnitId: losingUnit.id, effectiveAt: new Date("2026-03-01") });
      assert.equal(await db.occupancy.count({ where: { tenancyId: f.tenancy.id, status: "ACTIVE" } }), 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "tenancy.transferred" } }), 2);
    });
    await t.test("audit failure rolls back source, destination and occupancy changes", async () => {
      const f = await fixture();
      const before = await db.occupancy.findMany({ where: { tenancyId: f.tenancy.id } });
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_transfer_audit_failure CHECK (false) NOT VALID');
      try {
        await assert.rejects(transfer(f.scope, { tenancyId: f.tenancy.id, toUnitId: f.units[1].id, effectiveAt: new Date("2026-02-01") }));
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_transfer_audit_failure'); }
      assert.deepEqual(await db.occupancy.findMany({ where: { tenancyId: f.tenancy.id } }), before);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.units[0].id } })).status, "OCCUPIED");
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.units[1].id } })).status, "AVAILABLE");
      assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "tenancy.transferred" } }), 0);
    });
  } finally { await db.$disconnect(); }
});
