import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { migrationEnvironment, readProtectedMigrationUrl } from '../scripts/migrate-with-owner.mjs';

const runtime = 'postgresql://runtime:local-only@localhost:55480/example_ci';
const migration = 'postgresql://migrator:local-only@localhost:55480/example_ci';
test('migration credentials are confined to the migration child and target the same database', () => {
  const original = { DATABASE_URL: runtime, MIGRATION_DATABASE_URL: migration, OTHER: 'kept' };
  const result = migrationEnvironment(original);
  assert.equal(result.DATABASE_URL, migration);
  assert.equal(result.MIGRATION_DATABASE_URL, undefined);
  assert.equal(result.OTHER, 'kept');
  assert.equal(original.DATABASE_URL, runtime);
});
test('a migration-only file is used only by the migration child', () => {
  const path = '/run/secrets/stor24_migration_url';
  const source = { DATABASE_URL: runtime, MIGRATION_DATABASE_URL_FILE: path, OTHER: 'kept' };
  const child = migrationEnvironment(source, name => { assert.equal(name, path); return migration; });
  assert.equal(child.DATABASE_URL, migration);
  assert.equal(child.MIGRATION_DATABASE_URL_FILE, undefined);
  assert.equal(child.MIGRATION_DATABASE_URL, undefined);
  assert.equal(source.DATABASE_URL, runtime);
  assert.throws(() => migrationEnvironment({ ...source, MIGRATION_DATABASE_URL: migration }));
  assert.throws(() => migrationEnvironment({ ...source, MIGRATION_DATABASE_URL_FILE: '/tmp/other' }));
  assert.throws(() => migrationEnvironment(source, () => `${migration}?user=runtime`));
});
test('protected secret file rejects symlinks, loose permissions and malformed content', { skip: process.platform === 'win32' }, () => {
  const dir=mkdtempSync(join(tmpdir(),'stor24-migration-')); const file=join(dir,'secret'); const link=join(dir,'link');
  try {
    writeFileSync(file, `${migration}\n`, { mode: 0o600 }); assert.equal(readProtectedMigrationUrl(file), migration);
    symlinkSync(file,link); assert.throws(() => readProtectedMigrationUrl(link), /unavailable or unsafe/);
    const pipe=join(dir,'pipe'); execFileSync('mkfifo',[pipe]); assert.throws(() => readProtectedMigrationUrl(pipe), /unavailable or unsafe/);
    chmodSync(file,0o644); assert.throws(() => readProtectedMigrationUrl(file), /unavailable or unsafe/);
    chmodSync(file,0o600); for (const value of ['', 'x'.repeat(8193), `${migration}\nother`, `${migration}\0`]) { writeFileSync(file,value); assert.throws(() => readProtectedMigrationUrl(file), /unavailable or unsafe/); }
    assert.throws(() => readProtectedMigrationUrl(join(dir,'missing')), /unavailable or unsafe/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('missing, malformed, wrong target and same-role migration credentials fail closed', () => {
  for (const value of [undefined, 'invalid', 'https://migrator@localhost/example_ci', 'postgresql://runtime:other@localhost:55480/example_ci', 'postgresql://migrator:local-only@elsewhere:55480/example_ci', 'postgresql://migrator:local-only@localhost:55480/other_ci', 'postgresql://migrator:local-only@localhost:55480/example_ci?host=elsewhere', 'postgresql://runt%69me:other@localhost:55480/example_ci']) {
    assert.throws(() => migrationEnvironment({ DATABASE_URL: runtime, MIGRATION_DATABASE_URL: value }));
  }
});
test('connection query parameters cannot override either role or password', () => {
  for (const query of ['user=runtime', '%75ser=runtime', 'USER=runtime', 'password=other', 'options=-c%20role%3Druntime']) {
    assert.throws(() => migrationEnvironment({ DATABASE_URL: runtime, MIGRATION_DATABASE_URL: `${migration}?${query}` }));
    assert.throws(() => migrationEnvironment({ DATABASE_URL: `${runtime}?${query}`, MIGRATION_DATABASE_URL: migration }));
  }
  assert.equal(migrationEnvironment({ DATABASE_URL: `${runtime}?sslmode=require`, MIGRATION_DATABASE_URL: `${migration}?sslmode=require` }).DATABASE_URL, `${migration}?sslmode=require`);
  assert.throws(() => migrationEnvironment({ DATABASE_URL: runtime, MIGRATION_DATABASE_URL: migration, PGOPTIONS: '-c role=runtime' }), /PGOPTIONS/);
});
