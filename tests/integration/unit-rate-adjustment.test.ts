import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";

test("size price adjustment authorisation, exact preview, atomic writes and replay safety in isolated PostgreSQL", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/(merchandise_ci|unit_rate_adjustment_20261023)$/);
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Size pricing test", slug: key } });
  const foreignOrg = await db.organisation.create({ data: { name: "Other test", slug: `${key}-other` } });
  const actor = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "Synthetic staff", passwordHash: "synthetic" } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Test store", code: "T" } });
  const other = await db.facility.create({ data: { organisationId: org.id, name: "Other store", code: "O" } });
  const foreign = await db.facility.create({ data: { organisationId: foreignOrg.id, name: "Foreign store", code: "F" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Inventory manager", permissions: ["inventory.manage"] } });
  await db.roleAssignment.create({ data: { userId: actor.id, roleId: role.id, facilityId: facility.id } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "9 sqm", areaSqMetres: 9 } });
  const sameSize = await db.unitType.create({ data: { facilityId: facility.id, name: "Other 9 sqm", areaSqMetres: 9 } });
  const large = await db.unitType.create({ data: { facilityId: facility.id, name: "Large", areaSqMetres: 12 } });
  const create = (number: string, unitTypeId = type.id, monthlyRate = 100) => db.unit.create({ data: { facilityId: facility.id, unitTypeId, number, monthlyRate, taxRate: "0.15" } });
  const a = await create("A"), b = await create("B", sameSize.id, 200), untouched = await create("L", large.id);
  const component = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "Component", monthlyRate: 10, combinedIntoUnitId: a.id } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic" } });
  const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: a.id, quotedRate: 80, initialRentSnapshot: { amount: "80.00" } } });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
  const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, startDate: new Date() } });
  const occupancy = await db.occupancy.create({ data: { tenancyId: tenancy.id, unitId: b.id, monthlyRate: 150, startDate: new Date(), status: "ACTIVE" } });
  await db.unit.update({ where: { id: a.id }, data: { status: "RESERVED" } });
  await db.unit.update({ where: { id: b.id }, data: { status: "OCCUPIED" } });
  const session = { userId: actor.id, sessionVersion: actor.sessionVersion, mfaVerified: true };
  const output = await build({ entryPoints: ["src/app/api/v1/leasing/unit-rates/adjust/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "session", setup(builder) {
      builder.onResolve({ filter: /^@\/generated\/prisma\/client$/ }, () => ({ path: "prisma", namespace: "prisma-runtime" }));
      builder.onLoad({ filter: /.*/, namespace: "prisma-runtime" }, () => ({ contents: "export const Prisma=__prisma;" }));
      builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
    } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__session", "__prisma", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, session, Prisma);
  const input = { facilityId: facility.id, areaSqMetres: "9", direction: "INCREASE", mode: "RAND", value: "50" };
  const call = (body: object, origin = "https://example.invalid") => loaded.exports.POST(new Request("https://example.invalid/api/v1/leasing/unit-rates/adjust", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const preview = async () => { const response = await call({ ...input, action: "preview" }); assert.equal(response.status, 200); return (await response.json()).data; };
  const apply = (previewHash: string) => call({ ...input, action: "apply", previewHash });
  try {
    await t.test("deny wrong origin, missing permission, missing MFA, inactive user and other stores/organisations", async () => {
      assert.equal((await call({ ...input, action: "preview" }, "https://foreign.invalid")).status, 403);
      for (const id of [other.id, foreign.id]) assert.equal((await call({ ...input, facilityId: id, action: "preview" })).status, 403);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["inventory.view"] } });
      assert.equal((await call({ ...input, action: "preview" })).status, 403);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["inventory.manage"] } });
      session.mfaVerified = false; assert.equal((await call({ ...input, action: "preview" })).status, 403); session.mfaVerified = true;
      await db.user.update({ where: { id: actor.id }, data: { active: false } });
      assert.equal((await call({ ...input, action: "preview" })).status, 401);
      await db.user.update({ where: { id: actor.id }, data: { active: true } });
      assert.equal((await call({ ...input, action: "apply" })).status, 422);
    });
    await t.test("preview covers all same-size types/statuses without writing; tampering and membership drift reject", async () => {
      const plan = await preview();
      assert.deepEqual(new Set(plan.changes.map((row: { unitId: string }) => row.unitId)), new Set([a.id, b.id]));
      assert.equal(await db.auditEvent.count({ where: { facilityId: facility.id } }), 0);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: a.id } })).monthlyRate.toFixed(2), "100.00");
      assert.equal((await call({ ...input, action: "apply", value: "51", previewHash: plan.previewHash })).status, 409);
      const added = await create("Added"); assert.equal((await apply(plan.previewHash)).status, 409);
      await db.unit.delete({ where: { id: added.id } });
      await db.unit.update({ where: { id: a.id }, data: { monthlyRate: 101 } });
      assert.equal((await apply(plan.previewHash)).status, 409);
      await db.unit.update({ where: { id: a.id }, data: { monthlyRate: 100 } });
      assert.equal((await apply(plan.previewHash)).status, 409);
    });
    await t.test("audit failure rolls back every price; concurrent confirmation applies once and protects historical prices", async () => {
      const plan = await preview();
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT size_rate_audit_failure CHECK (action <> 'units.size_rates.adjusted') NOT VALID`);
      try { assert.equal((await apply(plan.previewHash)).status, 500); }
      finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT size_rate_audit_failure'); }
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: a.id } })).monthlyRate.toFixed(2), "100.00");
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: b.id } })).monthlyRate.toFixed(2), "200.00");
      const responses = await Promise.all([apply(plan.previewHash), apply(plan.previewHash)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      assert.equal((await apply(plan.previewHash)).status, 409);
      assert.equal(await db.auditEvent.count({ where: { facilityId: facility.id, action: "units.size_rates.adjusted" } }), 1);
      const units = await db.unit.findMany({ where: { facilityId: facility.id } });
      assert.equal(units.find(row => row.id === a.id)!.monthlyRate.toFixed(2), "150.00");
      assert.equal(units.find(row => row.id === b.id)!.monthlyRate.toFixed(2), "250.00");
      assert.equal(units.find(row => row.id === untouched.id)!.monthlyRate.toFixed(2), "100.00");
      assert.equal(units.find(row => row.id === component.id)!.monthlyRate.toFixed(2), "10.00");
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).quotedRate.toFixed(2), "80.00");
      assert.deepEqual((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).initialRentSnapshot, { amount: "80.00" });
      assert.equal((await db.occupancy.findUniqueOrThrow({ where: { id: occupancy.id } })).monthlyRate.toFixed(2), "150.00");
      assert.equal(units.find(row => row.id === a.id)!.taxRate.toString(), "0.15");
    });
  } finally {
    try {
      await db.reservation.deleteMany({ where: { facilityId: facility.id } });
      await db.occupancy.deleteMany({ where: { tenancyId: tenancy.id } });
      await db.tenancy.delete({ where: { id: tenancy.id } });
      await db.account.delete({ where: { id: account.id } });
      await db.organisation.deleteMany({ where: { id: { in: [org.id, foreignOrg.id] } } });
    } finally { await db.$disconnect(); }
  }
});
