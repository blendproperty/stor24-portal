// Full-schema synthetic recovery test; connection guards intentionally prohibit other targets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

assert.equal(process.env.DB_ROLE_TEST, 'isolated-ci');
const kind = process.env.RLS_RECOVERY_APP;
assert.ok(['crm', 'cms'].includes(kind));
const sourceName = kind === 'crm' ? 'crm_stage_ci' : 'cms_baseline_replay_ci';
const restoreName = kind === 'crm' ? 'crm_rls_restore_ci' : 'cms_rls_restore_ci';
const parse = (key, user, database) => {
  const u = new URL(process.env[key]);
  assert.ok(['postgres:', 'postgresql:'].includes(u.protocol)); assert.equal(u.search, '');
  assert.equal(u.hostname, 'localhost'); assert.equal(u.port, '55481');
  assert.equal(u.username, user); assert.equal(u.pathname, `/${database}`);
  return u.toString();
};
const ownerUrl = parse('MIGRATION_DATABASE_URL', 'stage_owner', sourceName);
const runtimeUrl = parse(kind === 'crm' ? 'DATABASE_URL' : 'DATABASE_URI', 'stage_runtime', sourceName);
const backupUrl = parse('RLS_BACKUP_URL', 'stage_backup_restore', sourceName);
const restoreUrl = parse('RLS_RESTORE_URL', 'stage_owner', restoreName);
const container = process.env.POSTGRES_CONTAINER;
assert.match(container || '', /^[a-f0-9]{12,64}$/);
const inspect = JSON.parse(execFileSync('docker', ['inspect', container], {encoding:'utf8'}))[0];
assert.equal(inspect.State.Running, true);
assert.ok(inspect.NetworkSettings.Ports['5432/tcp']?.some(p => p.HostPort === '55481'), 'container must serve guarded localhost port');
const clients = [ownerUrl,runtimeUrl,backupUrl,restoreUrl].map(connectionString => new pg.Client({connectionString}));
const [owner,runtime,backup,restore] = clients;
const token = randomUUID(), ids = [`rls-a-${token}`,`rls-b-${token}`], orgs = [`org-a-${token}`,`org-b-${token}`];
const relation = kind === 'crm' ? '"Customer"' : 'posts';
let enabled = false, fixture = false, policyCreated = false;
const queryFixtures = kind === 'crm'
  ? `SELECT id,"organisationId" AS scope,"firstName" AS label FROM "Customer" WHERE id=ANY($1::text[]) ORDER BY id`
  : `SELECT slug AS id,status AS scope,title AS label FROM posts WHERE slug=ANY($1::text[]) ORDER BY slug`;
const catalog = `SELECT 'table:'||c.relname AS item FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') UNION ALL SELECT 'index:'||indexname FROM pg_indexes WHERE schemaname='public' UNION ALL SELECT 'sequence:'||sequence_name FROM information_schema.sequences WHERE sequence_schema='public' UNION ALL SELECT 'constraint:'||c.relname||':'||con.conname FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT 'policy:'||tablename||':'||policyname FROM pg_policies WHERE schemaname='public' ORDER BY item`;
try {
  for (const c of clients) await c.connect();
  assert.equal((await restore.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')")).rows[0].n,0,'restore target must be empty');
  const flags=(await backup.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.deepEqual(Object.values(flags),[false,false,false,false,true]);
  assert.equal((await owner.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.${relation}'::regclass`)).rows[0].relrowsecurity,false,'source RLS state must be pristine');
  if (kind === 'crm') {
    await owner.query('INSERT INTO "Organisation" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now()),($2,$2,$2,now())',orgs); fixture=true;
    await owner.query('INSERT INTO "Customer" (id,"organisationId","firstName","updatedAt") VALUES ($1,$2,$3,now()),($4,$5,$6,now())',[ids[0],orgs[0],'Synthetic A',ids[1],orgs[1],'Synthetic B']);
  } else {
    await owner.query("INSERT INTO posts (title,slug,status) VALUES ($1,$2,'published'),($3,$4,'draft')",['Synthetic A',ids[0],'Synthetic B',ids[1]]); fixture=true;
  }
  const predicate=kind==='crm' ? `"organisationId"='${orgs[0]}'` : "status='published'";
  await owner.query(`CREATE POLICY synthetic_backup_test ON ${relation} FOR SELECT TO stage_runtime USING (${predicate})`); policyCreated=true;
  await owner.query(`ALTER TABLE ${relation} ENABLE ROW LEVEL SECURITY`); enabled=true;
  await owner.query(`ALTER TABLE ${relation} FORCE ROW LEVEL SECURITY`);
  assert.equal((await runtime.query(queryFixtures,[ids])).rowCount,1,'runtime must see only permitted synthetic row');
  assert.equal((await backup.query(queryFixtures,[ids])).rowCount,2,'backup bypass must include both synthetic rows');
  await assert.rejects(backup.query(`DELETE FROM ${relation} WHERE false`),e=>e.code==='42501');
  const sourceRows=(await backup.query(queryFixtures,[ids])).rows;
  const sourceCatalog=(await backup.query(catalog)).rows;
  const docker=(args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  docker(['pg_dump','-U','stage_backup_restore','-d',sourceName,'--format=custom','--no-owner','--no-privileges','-f',`/tmp/stor24-${kind}-rls-synthetic.dump`]);
  docker(['pg_restore','-U','stage_owner','-d',restoreName,'--exit-on-error','--no-owner','--no-privileges',`/tmp/stor24-${kind}-rls-synthetic.dump`]);
  assert.deepEqual((await restore.query(catalog)).rows,sourceCatalog,'tables, indexes, constraints, sequences and policies must survive restore');
  const state=(await restore.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.${relation}'::regclass`)).rows[0];
  assert.deepEqual(state,{relrowsecurity:true,relforcerowsecurity:true});
  // Owner is subject to forced RLS: inspect via backup identity and confirm restored runtime policy separately.
  const restoredBackup=new pg.Client({connectionString:backupUrl.replace(`/${sourceName}`,`/${restoreName}`)});
  const restoredRuntime=new pg.Client({connectionString:runtimeUrl.replace(`/${sourceName}`,`/${restoreName}`)});
  try {
    await restoredBackup.connect(); await restoredRuntime.connect();
    assert.deepEqual((await restoredBackup.query(queryFixtures,[ids])).rows,sourceRows);
    const tableNames=(await backup.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname")).rows.map(r=>r.relname);
    for (const name of tableNames) {
      const quoted='"'+name.replaceAll('"','""')+'"';
      const digest=`SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS digest FROM public.${quoted} t`;
      assert.deepEqual((await restoredBackup.query(digest)).rows,(await backup.query(digest)).rows,`restored table content differs: ${name}`);
    }
    console.log(JSON.stringify({application:kind,verifiedTableContents:tableNames.length}));
    await restore.query(`GRANT USAGE ON SCHEMA public TO stage_runtime`);
    await restore.query(`GRANT SELECT ON ${relation} TO stage_runtime`);
    assert.equal((await restoredRuntime.query(queryFixtures,[ids])).rowCount,1,'restored RLS policy must still filter');
  } finally { await restoredBackup.end(); await restoredRuntime.end(); }
  console.log(JSON.stringify({application:kind,fullDatabaseDump:true,syntheticRows:sourceRows.length,catalogEntries:sourceCatalog.length,forcedRlsRestored:true,privilegesRestored:false}));
} finally {
  if (enabled) { await owner.query(`ALTER TABLE ${relation} NO FORCE ROW LEVEL SECURITY`); await owner.query(`ALTER TABLE ${relation} DISABLE ROW LEVEL SECURITY`); }
  if (policyCreated) await owner.query(`DROP POLICY IF EXISTS synthetic_backup_test ON ${relation}`);
  if (fixture) {
    if(kind==='crm') { await owner.query('DELETE FROM "Customer" WHERE id=ANY($1::text[])',[ids]); await owner.query('DELETE FROM "Organisation" WHERE id=ANY($1::text[])',[orgs]); }
    else await owner.query('DELETE FROM posts WHERE slug=ANY($1::text[])',[ids]);
  }
  for(const c of clients) await c.end().catch(()=>{});
}
