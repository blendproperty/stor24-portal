import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";

test("isolated PostgreSQL configuration and audit commit together", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Configuration CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Synthetic" } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic configurator", email: `${key}@example.invalid` } });
  const output = await build({ entryPoints: ["src/app/api/v1/configuration/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-configuration", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const requirePermission=async()=>__auth; export const authErrorResponse=()=>Response.json({error:'synthetic failure'},{status:500});" }));
  } }] });
  const loaded = { exports: {} as { PUT: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__auth", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { organisationId: org.id, user: { id: user.id } });
  const send = (kind: string, payload: unknown) => loaded.exports.PUT(new Request("https://example.invalid/api/v1/configuration", { method: "PUT", body: JSON.stringify({ kind, payload }) }));
  let constraint = false;
  const rejectAudit = async () => {
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_configuration_audit_failure CHECK (false) NOT VALID'); constraint = true;
  };
  const restoreAudit = async () => {
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_configuration_audit_failure'); constraint = false;
  };
  const cases = [
    { kind: "profile", initial: { facilityId: facility.id, domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY", config: { version: 1 } }, changed: { config: { version: 2 } }, read: () => db.configurationProfile.findMany({ where: { organisationId: org.id } }) },
    { kind: "integration", initial: { facilityId: facility.id, category: "PHONE", provider: "Synthetic", status: "CONFIGURED", config: { notes: "Original" } }, changed: { config: { notes: "Changed" } }, read: () => db.integrationConnection.findMany({ where: { organisationId: org.id } }) },
    { kind: "charge", initial: { code: "TEST", name: "Synthetic charge", amount: 1 }, changed: { amount: 2 }, read: () => db.chargeDefinition.findMany({ where: { organisationId: org.id } }) },
    { kind: "discount", initial: { code: "TEST", name: "Synthetic discount", discountType: "FIXED", value: 1, rules: {} }, changed: { value: 2 }, read: () => db.discountPlan.findMany({ where: { organisationId: org.id } }) },
  ];
  try {
    for (const c of cases) await t.test(`${c.kind}: failed create/update roll back, valid saves retain response and audit`, async () => {
      const auditCount = await db.auditEvent.count({ where: { organisationId: org.id } });
      await rejectAudit();
      assert.equal((await send(c.kind, c.initial)).status, 500);
      assert.equal((await c.read()).length, 0);
      assert.equal(await db.auditEvent.count({ where: { organisationId: org.id } }), auditCount);
      await restoreAudit();
      const created = await send(c.kind, c.initial); assert.equal(created.status, 200);
      const before = JSON.parse(JSON.stringify(await c.read()));
      assert.equal(before.length, 1); assert.deepEqual((await created.json()).data, before[0]);
      await rejectAudit();
      assert.equal((await send(c.kind, { ...c.initial, ...c.changed })).status, 500);
      assert.deepEqual(JSON.parse(JSON.stringify(await c.read())), before);
      assert.equal(await db.auditEvent.count({ where: { organisationId: org.id } }), auditCount + 1);
      await restoreAudit();
      const updated = await send(c.kind, { ...c.initial, ...c.changed }); assert.equal(updated.status, 200);
      assert.equal((await c.read()).length, 1);
      assert.notDeepEqual(JSON.parse(JSON.stringify(await c.read())), before);
      const audits = await db.auditEvent.findMany({ where: { entityId: before[0].id } });
      assert.equal(audits.length, 2);
      for (const audit of audits) { assert.equal(audit.actorId, user.id); assert.equal(audit.organisationId, org.id); }
    });
  } finally { if (constraint) await restoreAudit(); await db.$disconnect(); }
});
