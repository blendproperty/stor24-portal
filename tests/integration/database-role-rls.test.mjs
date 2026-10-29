import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrationEnvironment } from '../../scripts/migrate-with-owner.mjs';

const runtimeUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;

test('isolated database role limits and RLS identity trust boundary', async () => {
  assert.equal(process.env.DB_ROLE_TEST, 'isolated-ci');
  migrationEnvironment(process.env);
  for (const value of [runtimeUrl, migrationUrl]) {
    const u = new URL(value);
    assert.ok(['localhost', '127.0.0.1'].includes(u.hostname));
    assert.match(u.pathname, /_ci$/);
  }
  const runtime = new pg.Client({ connectionString: runtimeUrl });
  const owner = new pg.Client({ connectionString: migrationUrl });
  const table = 'rls_probe_' + randomBytes(8).toString('hex');
  let created = false;
  try {
    await owner.connect(); await runtime.connect();
    const role = (await runtime.query(`SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_table
      FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(Object.values(role), [false, false, false, false, false, false, false]);
    const memberships = await runtime.query("SELECT r.rolname FROM pg_roles r WHERE r.rolname <> current_user AND pg_has_role(current_user,r.oid,'MEMBER')");
    assert.equal(memberships.rowCount, 0, 'synthetic runtime role has no inherited or assumable role membership');
    await assert.rejects(runtime.query('CREATE TABLE public.forbidden_ci (id integer)'), e => e.code === '42501');
    await owner.query(`CREATE TABLE public."${table}" (tenant text NOT NULL, value text NOT NULL)`); created = true;
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public."${table}" TO "${decodeURIComponent(new URL(runtimeUrl).username).replaceAll('"', '""')}"`);
    await owner.query(`INSERT INTO public."${table}" VALUES ('tenant-a','a'),('tenant-b','b')`);
    await owner.query(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
    await owner.query(`CREATE POLICY isolation ON public."${table}" USING (tenant=current_setting('app.synthetic_tenant',true)) WITH CHECK (tenant=current_setting('app.synthetic_tenant',true))`);
    assert.equal((await runtime.query(`SELECT * FROM public."${table}"`)).rowCount, 0, 'missing context fails closed');
    await runtime.query("SELECT set_config('app.synthetic_tenant','tenant-a',false)");
    assert.deepEqual((await runtime.query(`SELECT value FROM public."${table}"`)).rows.map(r=>r.value), ['a']);
    await assert.rejects(runtime.query(`INSERT INTO public."${table}" VALUES ('tenant-b','injected')`), e => e.code === '42501');
    assert.equal((await runtime.query(`UPDATE public."${table}" SET value='changed' WHERE tenant='tenant-b'`)).rowCount, 0);
    await runtime.query("SELECT set_config('app.synthetic_tenant','tenant-b',false)");
    assert.deepEqual((await runtime.query(`SELECT value FROM public."${table}"`)).rows.map(r=>r.value), ['b'], 'a mutable custom setting can be forged by the application role');
    assert.equal((await owner.query(`SELECT * FROM public."${table}"`)).rowCount, 2, 'table owners bypass RLS unless forced');
    await owner.query(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`);
    assert.equal((await owner.query(`SELECT * FROM public."${table}"`)).rowCount, 0, 'force subjects a non-superuser owner to RLS');
  } finally {
    await runtime.end().catch(() => {});
    if (created) await owner.query(`DROP TABLE public."${table}"`);
    await owner.end().catch(() => {});
  }
});
