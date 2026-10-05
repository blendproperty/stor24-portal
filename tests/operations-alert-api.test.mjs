import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const row = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic', email: 'test@example.invalid', mobile: '', channels: ['EMAIL'], enabled: true, consent: true };
async function fixture() {
  const state = { allowed: true, reads: [], writes: [], failAudit: false, profile: null };
  const client = pending => ({ configurationProfile: {
    findFirst: async ({ where }) => { state.reads.push(where); return pending.profile && where.organisationId === pending.profile.organisationId ? pending.profile : null; },
    create: async ({ data }) => (pending.profile = { ...data, updatedAt: new Date('2026-10-05T00:00:00.000Z') }),
    updateMany: async ({ where, data }) => { if (!pending.profile || pending.profile.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 }; pending.profile = { ...pending.profile, ...data, updatedAt: new Date('2026-10-05T00:00:01.000Z') }; return { count: 1 }; },
    findUniqueOrThrow: async () => pending.profile,
  }, auditEvent: { create: async ({ data }) => { if (state.failAudit) throw Error('audit failure'); pending.writes.push(data); } } });
  const db = { ...client(state), $transaction: async callback => { const pending = structuredClone(state); const result = await callback(client(pending)); state.profile = pending.profile; state.writes = pending.writes; return result; } };
  const output = await build({ entryPoints: ['src/app/api/v1/operations/alert-recipients/route.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated', setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards|request-security)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path.endsWith('/db') ? 'export const db=__db;' : a.path.endsWith('/auth-guards') ? "export const requireOwner=async()=>{if(!__state.allowed)throw Error('FORBIDDEN');return {user:{id:'actor',organisationId:'org'}}}; export const authErrorResponse=e=>Response.json({error:'denied'},{status:e.message==='FORBIDDEN'?403:500});" : "export const rateLimit=async()=>false;export const sameOrigin=r=>r.headers.get('origin')===new URL(r.url).origin;" }));
  } }] });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__db', '__state', output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, state);
  const send = (body, origin = 'https://example.invalid') => loaded.exports.PUT(new Request('https://example.invalid/api/v1/operations/alert-recipients', { method: 'PUT', headers: { origin }, body: JSON.stringify(body) }));
  return { state, send, get: loaded.exports.GET };
}
test('owner access and same-origin protection precede recipient reads or writes', async () => {
  const f = await fixture(); f.state.allowed = false;
  assert.equal((await f.get()).status, 403);
  assert.equal((await f.send({ recipients: [row], revision: null })).status, 403);
  assert.equal(f.state.reads.length, 0);
  f.state.allowed = true;
  assert.equal((await f.send({ recipients: [row], revision: null }, 'https://foreign.invalid')).status, 403);
  assert.equal(f.state.writes.length, 0);
});
test('recipient save and privacy-limited audit commit together; failed audit rolls back', async () => {
  const f = await fixture(); f.state.failAudit = true;
  assert.equal((await f.send({ recipients: [row], revision: null })).status, 500);
  assert.equal(f.state.profile, null); assert.equal(f.state.writes.length, 0);
  f.state.failAudit = false;
  const response = await f.send({ recipients: [row], revision: null });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.state.writes.length, 1);
  assert.doesNotMatch(JSON.stringify(f.state.writes), /example.invalid|Synthetic/);
  assert.ok(f.state.reads.every(r => r.organisationId === 'org'));
});
test('stale owner revisions and invalid lists never overwrite saved recipients', async () => {
  const f = await fixture(); await f.send({ recipients: [row], revision: null });
  const before = structuredClone(f.state.profile);
  assert.equal((await f.send({ recipients: [{ ...row, name: 'Changed' }], revision: null })).status, 409);
  assert.equal((await f.send({ recipients: [], revision: '2026-10-05T00:00:00.000Z' })).status, 422);
  assert.deepEqual(f.state.profile, before); assert.equal(f.state.writes.length, 1);
});

test('monitor reader rejects absent, wrong and malformed keys before reading the fixed organisation', async () => {
  const previousKey = process.env.STOR24_ALERT_CONFIG_KEY, previousOrg = process.env.STOR24_ALERT_ORGANISATION_ID;
  const reads = [], key = 'a'.repeat(64);
  const output = await build({ entryPoints: ['src/app/api/v1/operations/alert-monitor-config/route.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'monitor-fixture', setup(b) {
    b.onResolve({ filter: /^@\/lib\/operations-alerts$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const readOperationsAlerts=async organisationId=>{__reads.push(organisationId);return {recipients:__rows,revision:"synthetic"}};' }));
  } }] });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__reads', '__rows', output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, reads, [row]);
  try {
    process.env.STOR24_ALERT_CONFIG_KEY = key; process.env.STOR24_ALERT_ORGANISATION_ID = 'fixed-org';
    for (const authorization of ['', 'Bearer ' + 'b'.repeat(64), 'Bearer ' + '-'.repeat(64)]) {
      const r = await loaded.exports.GET(new Request('https://example.invalid/api/v1/operations/alert-monitor-config', { headers: { authorization } }));
      assert.equal(r.status, 401); assert.equal(r.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(reads.length, 0);
    const response = await loaded.exports.GET(new Request('https://example.invalid/api/v1/operations/alert-monitor-config?organisationId=foreign', { headers: { authorization: 'Bearer ' + key } }));
    assert.equal(response.status, 200); assert.deepEqual(reads, ['fixed-org']);
  } finally {
    if (previousKey === undefined) delete process.env.STOR24_ALERT_CONFIG_KEY; else process.env.STOR24_ALERT_CONFIG_KEY = previousKey;
    if (previousOrg === undefined) delete process.env.STOR24_ALERT_ORGANISATION_ID; else process.env.STOR24_ALERT_ORGANISATION_ID = previousOrg;
  }
});
