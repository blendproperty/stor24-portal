import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import { databaseConfig } from '../src/lib/database-limits.ts';

// Execute independent CommonJS evaluations of the actual production DB module,
// as separate server bundles can do. Replace only driver/client constructors;
// no database, credentials, application session or financial action is involved.
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const config = databaseConfig('postgresql://fixture:synthetic@127.0.0.1:5432/isolated', {});
function evaluateInFreshProcess() {
  const script = `
    const vm = require('node:vm');
    const assert = require('node:assert/strict');
    let clients = 0, adapters = 0, disconnects = 0;
    class Driver { constructor(value) { adapters++; assert.equal(value.max, 10); assert.equal(value.application_name, 'stor24-crm'); } }
    class Client { constructor(value) { clients++; this.adapter = value.adapter; } $disconnect() { disconnects++; } }
    const context = vm.createContext({ process: { env: { NODE_ENV: 'production', DATABASE_URL: 'synthetic-only' } } });
    const compiled = ${JSON.stringify(compiled)};
    function loadBundle() {
      const module = { exports: {} };
      const requireFixture = name => {
        if (name === '@/generated/prisma/client') return { PrismaClient: Client };
        if (name === '@prisma/adapter-pg') return { PrismaPg: Driver };
        if (name === '@/lib/database-limits') return { databaseConfig: () => (${JSON.stringify(config)}) };
        throw Error('UNEXPECTED_DB_MODULE_DEPENDENCY');
      };
      vm.runInContext('(function(require,module,exports){' + compiled + '\\n})', context)(requireFixture, module, module.exports);
      return module.exports.db;
    }
    const first = loadBundle();
    assert.equal(loadBundle(), first);
    assert.equal(loadBundle(), first);
    assert.equal(clients, 1);
    assert.equal(adapters, 1);
    assert.equal(disconnects, 0); // A bundle reload must not close another route's pool.
    console.log(JSON.stringify({ pid: process.pid, clients, adapters, disconnects }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('independent production bundles reuse one bounded client without disconnecting it', () => {
  const result = evaluateInFreshProcess();
  assert.deepEqual({ clients: result.clients, adapters: result.adapters, disconnects: result.disconnects }, { clients: 1, adapters: 1, disconnects: 0 });
});

test('separate application processes each initialise their own client and pool', () => {
  const first = evaluateInFreshProcess(), second = evaluateInFreshProcess();
  assert.notEqual(first.pid, second.pid);
  assert.equal(first.clients, 1); assert.equal(second.clients, 1);
});
