import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntimeDatabaseCredentialIsolation } from '../scripts/check-runtime-db-credential-isolation.mjs';

test('runtime preflight allows its connection but rejects known privileged credential variables', () => {
  assert.doesNotThrow(() => assertRuntimeDatabaseCredentialIsolation({ DATABASE_URL: 'synthetic-runtime' }));
  assert.throws(() => assertRuntimeDatabaseCredentialIsolation({}), /DATABASE_URL/);
  for (const key of ['POSTGRES_PASSWORD', 'PGPASSWORD', 'MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL_FILE']) {
    assert.throws(() => assertRuntimeDatabaseCredentialIsolation({ DATABASE_URL: 'synthetic-runtime', [key]: 'synthetic-secret-value' }), e => e.message.includes(key) && !e.message.includes('synthetic-secret-value'));
  }
});
