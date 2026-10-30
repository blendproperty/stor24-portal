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
const probe=`backup_privilege_${token.replaceAll('-','')}`;
let probeTable=false,probeSequence=false,probeView=false,probeSchema=false,probeSchemaTable=false;
const extraRlsTables = [];
const cmsPolicies = [
  ['posts_tags', "EXISTS (SELECT 1 FROM posts p WHERE p.id = posts_tags._parent_id AND p.status = 'published')"],
  ['storage_insights', "status = 'published'"],
  ...['storage_insights_faqs','storage_insights_internal_links','storage_insights_secondary_keywords'].map(table => [table, `EXISTS (SELECT 1 FROM storage_insights p WHERE p.id = ${table}._parent_id AND p.status = 'published')`]),
  ['storage_insights_schema_types', "EXISTS (SELECT 1 FROM storage_insights p WHERE p.id = storage_insights_schema_types.parent_id AND p.status = 'published')"],
  ['micro_warehousing','published IS TRUE'],
];
const queryFixtures = kind === 'crm'
  ? `SELECT id,"organisationId" AS scope,"firstName" AS label FROM "Customer" WHERE id=ANY($1::text[]) ORDER BY id`
  : `SELECT slug AS id,status AS scope,title AS label FROM posts WHERE slug=ANY($1::text[]) ORDER BY slug`;
const catalog = `SELECT 'table:'||c.relname AS item FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') UNION ALL SELECT 'index:'||indexname FROM pg_indexes WHERE schemaname='public' UNION ALL SELECT 'sequence:'||sequence_name FROM information_schema.sequences WHERE sequence_schema='public' UNION ALL SELECT 'constraint:'||c.relname||':'||con.conname FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT 'policy:'||tablename||':'||policyname FROM pg_policies WHERE schemaname='public' ORDER BY item`;
try {
  for (const c of clients) await c.connect();
  assert.equal((await restore.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')")).rows[0].n,0,'restore target must be empty');
  const flags=(await backup.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.deepEqual(Object.values(flags),[false,false,false,false,true]);
  const writableObjects=async()=> (await backup.query(`
    SELECT 'table:'||n.nspname||'.'||c.relname AS object FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind IN ('r','p','v','m','f') AND (
      has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES'))
    UNION ALL SELECT 'sequence:'||n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE') ORDER BY object`)).rows.map(row=>row.object);
  assert.deepEqual(await writableObjects(),[], 'backup role must not have effective write privileges on any existing application table, view or sequence');
  assert.equal((await backup.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS allowed")).rows[0].allowed,false);
  assert.equal((await backup.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') AS allowed")).rows[0].allowed,false);
  const unapprovedMemberships=async()=> (await backup.query("SELECT r.rolname FROM pg_roles r WHERE r.rolname <> current_user AND r.rolname <> 'pg_read_all_data' AND pg_has_role(current_user,r.oid,'MEMBER') ORDER BY r.rolname")).rows.map(row=>row.rolname);
  assert.deepEqual(await unapprovedMemberships(),[], 'backup may not inherit or assume any unapproved role, including NOINHERIT memberships');
  const admin=(inspect.Config.Env.find(v=>v.startsWith('POSTGRES_USER=')) || 'POSTGRES_USER=postgres').slice('POSTGRES_USER='.length);
  assert.match(admin,/^[a-zA-Z_][a-zA-Z_0-9]*$/);
  const roleGrant=sql=>execFileSync('docker',['exec',container,'psql','-X','-v','ON_ERROR_STOP=1','-U',admin,'-d',sourceName,'-c',sql],{stdio:'ignore'});
  try {
    roleGrant('GRANT stage_runtime TO stage_backup_restore WITH INHERIT FALSE, SET TRUE');
    assert.ok((await unapprovedMemberships()).includes('stage_runtime'),'audit must catch an assumable NOINHERIT role');
  } finally { roleGrant('REVOKE stage_runtime FROM stage_backup_restore'); }
  assert.deepEqual(await unapprovedMemberships(),[]);
  for (const role of ['stage_owner','stage_runtime','stage_tenant_a','stage_tenant_b']) {
    assert.equal((await backup.query('SELECT pg_has_role(current_user,$1,$2) AS allowed',[role,'MEMBER'])).rows[0].allowed,false,`backup membership: ${role}`);
    await assert.rejects(backup.query(`SET ROLE "${role}"`),error=>error.code==='42501');
  }
  await assert.rejects(backup.query('CREATE TABLE public.synthetic_backup_forbidden (id integer)'),error=>error.code==='42501');
  // pg_read_all_data intentionally exposes future objects cluster-wide; detect writes rather than treating it as least privilege.
  await owner.query(`CREATE TABLE "${probe}" (id integer)`);probeTable=true;
  await owner.query(`CREATE SEQUENCE "${probe}_seq"`);probeSequence=true;
  await owner.query(`CREATE VIEW "${probe}_view" AS SELECT id FROM "${probe}"`);probeView=true;
  await owner.query(`CREATE SCHEMA "${probe}_schema"`);probeSchema=true;
  await owner.query(`CREATE TABLE "${probe}_schema".probe (id integer)`);probeSchemaTable=true;
  await owner.query(`INSERT INTO "${probe}_schema".probe VALUES (99)`);
  await owner.query(`INSERT INTO "${probe}" VALUES (42)`);
  await owner.query(`SELECT setval('public."${probe}_seq"',42,true)`);
  assert.equal((await backup.query(`SELECT id FROM "${probe}"`)).rows[0].id,42,'built-in read role covers future owner-created data');
  await assert.rejects(backup.query(`SELECT nextval('public."${probe}_seq"')`),error=>error.code==='42501');
  try {
    await owner.query(`GRANT UPDATE ON "${probe}" TO stage_backup_restore`);
    await owner.query(`GRANT USAGE ON SEQUENCE "${probe}_seq" TO stage_backup_restore`);
    await owner.query(`GRANT UPDATE ON "${probe}_view" TO stage_backup_restore`);
    await owner.query(`GRANT UPDATE ON "${probe}_schema".probe TO stage_backup_restore`);
    const detected=await writableObjects();
    assert.ok(detected.includes(`table:public.${probe}`),'audit must catch a table write grant');
    assert.ok(detected.includes(`sequence:public.${probe}_seq`),'audit must catch a sequence write grant');
    assert.ok(detected.includes(`table:public.${probe}_view`),'audit must catch an updatable view grant');
    assert.ok(detected.includes(`table:${probe}_schema.probe`),'audit must catch writes in another schema');
  } finally {
    await owner.query(`REVOKE UPDATE ON "${probe}" FROM stage_backup_restore`);
    await owner.query(`REVOKE USAGE ON SEQUENCE "${probe}_seq" FROM stage_backup_restore`);
    await owner.query(`REVOKE UPDATE ON "${probe}_view" FROM stage_backup_restore`);
    await owner.query(`REVOKE UPDATE ON "${probe}_schema".probe FROM stage_backup_restore`);
  }
  assert.deepEqual(await writableObjects(),[], 'backup role must remain read-only after the probe');

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
  if (kind === 'cms') for (const [table,condition] of cmsPolicies) {
    assert.equal((await owner.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[`public.${table}`])).rows[0].relrowsecurity,false);
    await owner.query(`CREATE POLICY synthetic_backup_test ON "${table}" FOR SELECT TO stage_runtime USING (${condition})`);
    extraRlsTables.push(table);
    await owner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await owner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  }
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
  for (const table of extraRlsTables) {
    const restoredState=(await restore.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[`public.${table}`])).rows[0];
    assert.deepEqual(restoredState,{relrowsecurity:true,relforcerowsecurity:true},`RLS state restored: ${table}`);
  }
  // Owner is subject to forced RLS: inspect via backup identity and confirm restored runtime policy separately.
  const restoredBackup=new pg.Client({connectionString:backupUrl.replace(`/${sourceName}`,`/${restoreName}`)});
  const restoredRuntime=new pg.Client({connectionString:runtimeUrl.replace(`/${sourceName}`,`/${restoreName}`)});
  try {
    await restoredBackup.connect(); await restoredRuntime.connect();
    assert.deepEqual((await restoredBackup.query(queryFixtures,[ids])).rows,sourceRows);
    assert.deepEqual((await restoredBackup.query(`SELECT id FROM "${probe}"`)).rows,[{id:42}],'future table data survives full backup');
    assert.deepEqual((await restoredBackup.query(`SELECT id FROM "${probe}_view"`)).rows,[{id:42}],'future view survives full backup');
    assert.deepEqual((await restoredBackup.query(`SELECT id FROM "${probe}_schema".probe`)).rows,[{id:99}],'future schema data survives full backup');
    assert.deepEqual((await restoredBackup.query(`SELECT last_value,is_called FROM "${probe}_seq"`)).rows,(await backup.query(`SELECT last_value,is_called FROM "${probe}_seq"`)).rows,'future sequence state survives full backup');
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
  console.log(JSON.stringify({application:kind,fullDatabaseDump:true,syntheticRows:sourceRows.length,catalogEntries:sourceCatalog.length,forcedRlsRestored:true,rlsTables:1+extraRlsTables.length,privilegesRestored:false}));
} finally {
  if(probeView) await owner.query(`DROP VIEW "${probe}_view"`);
  if(probeSchemaTable) await owner.query(`DROP TABLE "${probe}_schema".probe`);
  if(probeSchema) await owner.query(`DROP SCHEMA "${probe}_schema"`);
  if(probeSequence) await owner.query(`DROP SEQUENCE "${probe}_seq"`);
  if(probeTable) await owner.query(`DROP TABLE "${probe}"`);
  for (const table of extraRlsTables) {
    await owner.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
    await owner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    await owner.query(`DROP POLICY IF EXISTS synthetic_backup_test ON "${table}"`);
  }
  if (enabled) { await owner.query(`ALTER TABLE ${relation} NO FORCE ROW LEVEL SECURITY`); await owner.query(`ALTER TABLE ${relation} DISABLE ROW LEVEL SECURITY`); }
  if (policyCreated) await owner.query(`DROP POLICY IF EXISTS synthetic_backup_test ON ${relation}`);
  if (fixture) {
    if(kind==='crm') { await owner.query('DELETE FROM "Customer" WHERE id=ANY($1::text[])',[ids]); await owner.query('DELETE FROM "Organisation" WHERE id=ANY($1::text[])',[orgs]); }
    else await owner.query('DELETE FROM posts WHERE slug=ANY($1::text[])',[ids]);
  }
  for(const c of clients) await c.end().catch(()=>{});
}
