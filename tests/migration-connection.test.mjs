import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationEnvironment } from '../scripts/migrate-with-owner.mjs';

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
