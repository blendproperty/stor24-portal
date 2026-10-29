import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import { requireLeasingCustomer } from '../../src/lib/leasing-customer-scope.ts';

// This test alters one actual table only in the explicitly named disposable database.
test('role-bound policies on real Customer table isolate two synthetic organisations', async () => {
  assert.equal(process.env.DB_ROLE_TEST, 'isolated-ci');
  const entries = [['MIGRATION_DATABASE_URL','stage_owner'], ['DATABASE_URL','stage_runtime'], ['TENANT_A_URL','stage_tenant_a'], ['TENANT_B_URL','stage_tenant_b'], ['BACKUP_ROLE_URL','stage_backup']];
  const clients = [];
  for (const [key, user] of entries) {
    const u = new URL(process.env[key]);
    assert.equal(u.hostname, 'localhost'); assert.equal(u.port, '55481');
    assert.equal(u.pathname, '/crm_stage_ci'); assert.equal(u.username, user);
    clients.push(new pg.Client({ connectionString: u.toString() }));
  }
  const [owner, runtime, a, b, backup] = clients;
  const token = randomUUID(), orgA = `org-a-${token}`, orgB = `org-b-${token}`, recordA = `customer-a-${token}`, recordB = `customer-b-${token}`;
  const policyA = `stage_a_${token.replaceAll('-', '')}`, policyB = `stage_b_${token.replaceAll('-', '')}`;
  let created = false, enabled = false, prismaA, prismaB;
  try {
    for (const c of clients) await c.connect();
    const state = await owner.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public."Customer"'::regclass`);
    assert.equal(state.rows[0].relrowsecurity, false, 'refuse an existing RLS configuration');
    await owner.query(`INSERT INTO "Organisation" (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now()),($4,$5,$6,now())`, [orgA,'Synthetic A',orgA,orgB,'Synthetic B',orgB]); created = true;
    await owner.query(`INSERT INTO "Customer" (id,"organisationId","firstName","updatedAt") VALUES ($1,$2,$3,now()),($4,$5,$6,now())`, [recordA,orgA,'Synthetic A',recordB,orgB,'Synthetic B']);
    await owner.query('GRANT USAGE ON SCHEMA public TO stage_tenant_a, stage_tenant_b');
    await owner.query('GRANT SELECT,INSERT,UPDATE,DELETE ON "Customer" TO stage_tenant_a, stage_tenant_b');
    await owner.query(`CREATE POLICY "${policyA}" ON "Customer" TO stage_tenant_a USING ("organisationId"='${orgA}') WITH CHECK ("organisationId"='${orgA}')`);
    await owner.query(`CREATE POLICY "${policyB}" ON "Customer" TO stage_tenant_b USING ("organisationId"='${orgB}') WITH CHECK ("organisationId"='${orgB}')`);
    await owner.query('ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY'); enabled = true;
    assert.deepEqual((await a.query('SELECT id FROM "Customer" ORDER BY id')).rows.map(r => r.id), [recordA]);
    assert.deepEqual((await b.query('SELECT id FROM "Customer" ORDER BY id')).rows.map(r => r.id), [recordB]);
    assert.equal((await runtime.query('SELECT id FROM "Customer"')).rowCount, 0, 'unmapped shared runtime fails closed');
    await backup.query('SET row_security = off');
    await assert.rejects(backup.query('SELECT id FROM "Customer"'), e => e.code === '42501' && /row.level security/i.test(e.message), 'a backup role without RLS bypass must fail rather than silently omit rows');
    prismaA = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TENANT_A_URL }) });
    prismaB = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TENANT_B_URL }) });
    for (let i = 0; i < 4; i++) {
      const [rowsA, rowsB] = await Promise.all([
        prismaA.customer.findMany({ where: { id: { in: [recordA, recordB] } }, select: { id: true } }),
        prismaB.customer.findMany({ where: { id: { in: [recordA, recordB] } }, select: { id: true } }),
      ]);
      assert.deepEqual(rowsA.map(row => row.id), [recordA]);
      assert.deepEqual(rowsB.map(row => row.id), [recordB]);
    }
    await assert.rejects(prismaA.customer.update({ where: { id: recordB }, data: { firstName: 'blocked' } }));
    const scopeA = { userId: 'synthetic', organisationId: orgA, facilityIds: [], unrestrictedFacilities: true };
    const scopeB = { userId: 'synthetic', organisationId: orgB, facilityIds: [], unrestrictedFacilities: true };
    assert.equal((await requireLeasingCustomer(scopeA, recordA, prismaA)).id, recordA);
    assert.equal((await requireLeasingCustomer(scopeB, recordB, prismaB)).id, recordB);
    await assert.rejects(requireLeasingCustomer(scopeB, recordB, prismaA), /FORBIDDEN/, 'actual CRM scope helper cannot bypass the database role');
    await assert.rejects(a.query('INSERT INTO "Customer" (id,"organisationId","updatedAt") VALUES ($1,$2,now())', [`bad-${token}`,orgB]), e => e.code === '42501');
    assert.equal((await a.query('UPDATE "Customer" SET "firstName"=$1 WHERE id=$2', ['bad',recordB])).rowCount, 0);
    await a.query("SELECT set_config('app.synthetic_tenant',$1,false)", [orgB]);
    assert.deepEqual((await a.query('SELECT id FROM "Customer"')).rows.map(r => r.id), [recordA], 'forged custom setting does not change a role-bound policy');
    await assert.rejects(a.query('SET ROLE stage_tenant_b'), e => e.code === '42501');
    await assert.rejects(runtime.query('SET ROLE stage_tenant_a'), e => e.code === '42501');
  } finally {
    await prismaA?.$disconnect(); await prismaB?.$disconnect();
    if (enabled) await owner.query('ALTER TABLE "Customer" DISABLE ROW LEVEL SECURITY');
    await owner.query(`DROP POLICY IF EXISTS "${policyA}" ON "Customer"`).catch(() => {});
    await owner.query(`DROP POLICY IF EXISTS "${policyB}" ON "Customer"`).catch(() => {});
    await owner.query('REVOKE SELECT,INSERT,UPDATE,DELETE ON "Customer" FROM stage_tenant_a, stage_tenant_b').catch(() => {});
    if (created) await owner.query('DELETE FROM "Customer" WHERE id=ANY($1::text[])', [[recordA,recordB]]).then(() => owner.query('DELETE FROM "Organisation" WHERE id=ANY($1::text[])', [[orgA,orgB]]));
    for (const c of clients) await c.end().catch(() => {});
  }
});
