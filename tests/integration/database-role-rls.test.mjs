import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { runtimeRoleViolations } from '../../scripts/check-runtime-database-role.mjs';
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
  const adminUrl = new URL(process.env.ROLE_TEST_ADMIN_URL);
  assert.ok(['localhost','127.0.0.1'].includes(adminUrl.hostname));
  assert.equal(adminUrl.pathname,new URL(runtimeUrl).pathname);
  assert.equal(adminUrl.port,new URL(runtimeUrl).port);
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  const runtime = new pg.Client({ connectionString: runtimeUrl });
  const owner = new pg.Client({ connectionString: migrationUrl });
  const table = 'rls_probe_' + randomBytes(8).toString('hex');
  let created = false, memberCreated = false, memberGranted = false;
  const member = 'role_probe_' + randomBytes(8).toString('hex');
  try {
    await owner.connect(); await runtime.connect(); await admin.connect();
    const role = (await runtime.query(`SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_table
      FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(Object.values(role), [false, false, false, false, false, false, false]);
    assert.deepEqual(await runtimeRoleViolations(runtime), [], 'restricted runtime passes the opt-in role preflight');
    const cli=(url,target='crm')=>spawnSync(process.execPath,['scripts/check-runtime-database-role.mjs'],{encoding:'utf8',env:{...process.env,STOR24_ROLE_TARGET:target,DATABASE_URL:url}});
    const allowed=cli(runtimeUrl);assert.equal(allowed.status,0);assert.equal(JSON.parse(allowed.stdout).catalogPreflightPassed,true);
    const denied=cli(adminUrl.toString());assert.equal(denied.status,1);assert.equal(JSON.parse(denied.stderr).catalogPreflightPassed,false);
    assert.equal(cli(runtimeUrl,'').status,1,'missing target must fail');
    const failed=cli('postgresql://synthetic-user:synthetic-secret-value@localhost:1/rls_probe_ci');assert.equal(failed.status,1);assert.ok(!(failed.stdout+failed.stderr).includes('synthetic-secret-value'),'connection errors must not expose credentials');

    assert.ok((await runtimeRoleViolations(admin)).includes('rolsuper'), 'superuser must fail the preflight');
    await admin.query(`CREATE ROLE "${member}" NOLOGIN`); memberCreated=true;
    await admin.query(`GRANT "${member}" TO synthetic_runtime WITH INHERIT FALSE, SET TRUE`); memberGranted=true;
    assert.ok((await runtimeRoleViolations(runtime)).includes('role_membership'), 'assumable NOINHERIT membership must fail the preflight');
    await admin.query(`REVOKE "${member}" FROM synthetic_runtime`); memberGranted=false;

    assert.ok((await runtimeRoleViolations(owner)).includes('owns_database'), 'database owner must fail the runtime role preflight');
    await owner.query('GRANT CREATE ON SCHEMA public TO synthetic_runtime');
    try { assert.ok((await runtimeRoleViolations(runtime)).includes('schema_create'), 'schema CREATE must fail the runtime preflight'); }
    finally { await owner.query('REVOKE CREATE ON SCHEMA public FROM synthetic_runtime'); }
    const memberships = await runtime.query("SELECT r.rolname FROM pg_roles r WHERE r.rolname <> current_user AND pg_has_role(current_user,r.oid,'MEMBER')");
    assert.equal(memberships.rowCount, 0, 'synthetic runtime role has no inherited or assumable role membership');
    await assert.rejects(runtime.query('CREATE TABLE public.forbidden_ci (id integer)'), e => e.code === '42501');
    await owner.query(`CREATE TABLE public."${table}" (tenant text NOT NULL, value text NOT NULL)`); created = true;
    await admin.query(`ALTER TABLE public."${table}" OWNER TO synthetic_runtime`);
    try { assert.ok((await runtimeRoleViolations(runtime)).includes('owned_objects'), 'runtime-owned table must fail the preflight'); }
    finally { await admin.query(`ALTER TABLE public."${table}" OWNER TO synthetic_migrator`); }

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
    if(memberGranted) await admin.query(`REVOKE "${member}" FROM synthetic_runtime`);
    if(memberCreated) await admin.query(`DROP ROLE "${member}"`);
    await admin.end().catch(() => {});
    await runtime.end().catch(() => {});
    if (created) await owner.query(`DROP TABLE public."${table}"`);
    await owner.end().catch(() => {});
  }
});
