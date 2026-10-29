import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('raw SQL inventory excludes generated code and identifies real health and lock calls', () => {
  const child = spawnSync(process.execPath,['scripts/audit-raw-database-calls.mjs'],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);
  const inventory=JSON.parse(child.stdout);
  assert.ok(inventory.calls > 0);
  assert.ok(inventory.results.every(row=>!row.file.startsWith('src/generated/')));
  const health=inventory.results.find(row=>row.file==='src/app/api/health/route.ts');
  const lock=inventory.results.find(row=>row.file==='src/lib/customer-contact-lock.ts');
  const collections=inventory.results.find(row=>row.file==='src/lib/collections-service.ts');
  assert.ok(health?.calls.some(call=>call.method==='$queryRaw' && !call.interpolated && !call.tables.length));
  assert.ok(lock?.calls.some(call=>call.functions.includes('pg_advisory_xact_lock')));
  assert.ok(collections?.calls.some(call=>call.rowLock && call.tables.some(table=>table.table==='Account' && table.operations.includes('SELECT') && table.operations.includes('UPDATE'))));
});
