// Disposable synthetic database only: never connect this experiment to a deployed system.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', ...options });
let id;
try {
  id = docker(['run', '-d', '--label', 'stor24.synthetic-rls-backup-test', '-e', 'POSTGRES_PASSWORD=synthetic-admin-only', 'postgres:16-alpine']).trim();
  assert.match(id, /^[a-f0-9]{64}$/);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(['exec', id, 'pg_isready', '-U', 'postgres']); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  assert.ok(ready, 'synthetic database must start');
  const sql = (db, statement) => docker(['exec', id, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db, '-Atc', statement]);
  sql('postgres', `CREATE ROLE stage_owner LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE stage_app LOGIN PASSWORD 'synthetic-app' NOSUPERUSER NOBYPASSRLS; CREATE ROLE stage_backup LOGIN PASSWORD 'synthetic-backup' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS`);
  sql('postgres', 'CREATE DATABASE source_ci OWNER stage_owner');
  sql('postgres', 'CREATE DATABASE restore_ci OWNER stage_owner');
  sql('source_ci', `REVOKE CREATE ON SCHEMA public FROM PUBLIC; SET ROLE stage_owner; CREATE TABLE public.sensitive (tenant text NOT NULL, value text NOT NULL); CREATE TABLE public.ungranted (value text); INSERT INTO public.sensitive VALUES ('a','synthetic-a'),('b','synthetic-b'); ALTER TABLE public.sensitive ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sensitive FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_a ON public.sensitive TO stage_app USING (tenant='a'); GRANT USAGE ON SCHEMA public TO stage_app, stage_backup; GRANT SELECT ON public.sensitive TO stage_app, stage_backup`);
  const asRole = (role, password, statement) => docker(['exec', '-e', `PGPASSWORD=${password}`, id, 'psql', '-h', 'localhost', '-X', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'source_ci', '-Atc', statement], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(asRole('stage_app', 'synthetic-app', 'SELECT count(*) FROM public.sensitive').trim(), '1');
  assert.equal(asRole('stage_backup', 'synthetic-backup', 'SELECT count(*) FROM public.sensitive').trim(), '2');
  for (const statement of ["INSERT INTO public.sensitive VALUES ('c','blocked')", "UPDATE public.sensitive SET value='blocked'", 'DELETE FROM public.sensitive', 'SELECT * FROM public.ungranted', 'CREATE TABLE public.forbidden(id int)', 'SET ROLE stage_app']) {
    assert.throws(() => asRole('stage_backup', 'synthetic-backup', statement), error => /permission denied/i.test(String(error.stderr)), `backup role must reject: ${statement}`);
  }
  const flags = asRole('stage_backup', 'synthetic-backup', "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user").trim();
  assert.equal(flags, 'f|f|f|f|t');
  const dump = docker(['exec', '-e', 'PGPASSWORD=synthetic-backup', id, 'pg_dump', '-h', 'localhost', '-U', 'stage_backup', '-d', 'source_ci', '--data-only', '--table=public.sensitive']);
  sql('restore_ci', 'SET ROLE stage_owner; CREATE TABLE public.sensitive (tenant text NOT NULL, value text NOT NULL)');
  docker(['exec', '-i', id, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'restore_ci'], { input: dump });
  assert.equal(sql('restore_ci', "SELECT string_agg(tenant || ':' || value, ',' ORDER BY tenant) FROM public.sensitive").trim(), 'a:synthetic-a,b:synthetic-b');
  console.log('Synthetic RLS backup: both rows restored; role cannot write, create or assume the app role.');
} finally {
  if (id && /^[a-f0-9]{64}$/.test(id)) docker(['rm', '-f', '-v', id], { stdio: 'ignore' });
}
