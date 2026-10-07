import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { recent, safeHostStatus, safeMonitorEntry } from '../src/lib/operations-status-policy.mjs';
import { collect } from '../scripts/collect-operations-status.mjs';
import { saveMonitor } from '../scripts/write-monitor-status.mjs';

test('operational evidence is allowlisted, bounded and stale data is not current', () => {
  const checkedAt = new Date().toISOString();
  const host = safeHostStatus({ checkedAt, diskUsedPercent: 101, memoryAvailablePercent: 55, image: 'password=secret', env: 'secret', databaseConnections: NaN });
  assert.equal(host.diskUsedPercent, null); assert.equal(host.memoryAvailablePercent, 55); assert.equal(host.image, null); assert.equal(host.databaseConnections, null); assert.equal(host.env, undefined);
  assert.equal(recent(new Date(Date.now() - 4 * 60_000).toISOString(), 3 * 60_000), false);
  assert.equal(safeMonitorEntry({ runId: 'https://evil.invalid', checkedAt }), null);
  const monitor = safeMonitorEntry({ checkedAt, runId: 12, readiness: 'success', backup: 'failure', status: 'ATTEMPTED', recipientSource: 'SAVED_RECIPIENTS', results: [{ channel: 'SMS', accepted: true, to: 'private', reference: 'secret' }, { channel: 'SMS', accepted: false }] });
  assert.deepEqual(monitor.channels[1], { channel: 'SMS', accepted: 1, failed: 1 }); assert.ok(!JSON.stringify(monitor).includes('private')); assert.ok(!JSON.stringify(monitor).includes('secret'));
});
test('host collector records aggregate read-only checks and continues with unknown probes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stor24-diagnostics-'));
  const calls = [];
  try {
    const run = (name, args) => { calls.push({ name, args }); return { status: 0, stdout: args[0] === 'inspect' ? JSON.stringify({ health: 'healthy', oom: false, image: 'stor24-crm:1234567' }) : '7/100' }; };
    const row = await collect({ root, run, disk: () => ({ blocks: 100, bavail: 40 }), read: () => 'MemAvailable: 600\nMemTotal: 1000' });
    assert.equal(row.diskUsedPercent, 60); assert.equal(row.memoryAvailablePercent, 60); assert.equal(row.databaseConnections, 7);
    assert.ok(calls.every(c => c.name === 'docker')); assert.ok(calls[1].args.at(-1).startsWith('SELECT ')); assert.ok(!calls[0].args.includes('{{json .}}'));
    const missing = await collect({ root, run: () => ({ status: 1 }), disk: () => { throw Error(); }, read: () => { throw Error(); } });
    assert.equal(missing.appHealth, 'unknown'); assert.equal(missing.diskUsedPercent, null);
    assert.equal(JSON.parse(await readFile(path.join(root, 'operations.json'), 'utf8')).appHealth, 'unknown');
  } finally { await rm(root, { recursive: true }); }
});
test('monitor writer retains bounded, deduplicated history without provider/contact details', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stor24-monitor-'));
  try {
    for (let id = 1; id <= 25; id++) await saveMonitor({ runId: id, checkedAt: new Date(Date.now() - 30_000 + id * 100).toISOString(), readiness: 'success', backup: 'success', status: 'HEALTHY_NO_NOTIFICATION', email: 'private@example.invalid', token: 'secret' }, root);
    const rows = await saveMonitor({ runId: 25, checkedAt: new Date().toISOString(), readiness: 'success', backup: 'failure', status: 'UNAVAILABLE' }, root);
    assert.equal(rows.length, 20); assert.equal(rows[0].runId, '25'); assert.equal(rows[0].backup, 'failure');
    const text = await readFile(path.join(root, 'monitor.json'), 'utf8'); assert.ok(!text.includes('private')); assert.ok(!text.includes('token'));
    await assert.rejects(saveMonitor({ runId: 'x' }, root), /INVALID/);
  } finally { await rm(root, { recursive: true }); }
});
async function apiFixture() {
  const bundle = await build({ stdin: { contents: 'export {GET} from "./src/app/api/v1/operations/diagnostics/route";export {setOwner} from "@/lib/auth-guards";export {reads} from "@/lib/operations-diagnostics";export {guardState} from "@/lib/dlp-transfer-service";', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'isolated', setup(b) {
    b.onResolve({ filter: /^@\/lib\/(auth-guards|operations-diagnostics|dlp-transfer-service)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('dlp-transfer-service') ? 'export const guardState={records:[],fail:false};export async function guardDlpTransfer(input){guardState.records.push(input);if(guardState.fail)throw Error("AUDIT_DOWN");return {"cache-control":"private, no-store","x-request-id":"synthetic"};}' : args.path.endsWith('auth-guards') ? 'let owner;export const setOwner=x=>owner=x;export async function requireOwner(){if(!owner)throw Error("FORBIDDEN");return {user:{id:"synthetic-owner",organisationId:owner}}}export const authErrorResponse=e=>Response.json({error:e.message==="FORBIDDEN"?"forbidden":"internal"},{status:e.message==="FORBIDDEN"?403:500});' : 'export const reads=[];export async function operationsDiagnostics(org){reads.push(org);return {cards:[]}}' }));
  } }] });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
test('diagnostics require current owner and fixed monitored organisation before reading evidence', async () => {
  const prior = process.env.STOR24_ALERT_ORGANISATION_ID; process.env.STOR24_ALERT_ORGANISATION_ID = 'monitored-org';
  try {
    const f = await apiFixture(); assert.equal((await f.GET()).status, 403); f.setOwner('other-org'); assert.equal((await f.GET()).status, 403); assert.deepEqual(f.reads, []);
    f.setOwner('monitored-org'); const r = await f.GET(); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(f.reads, ['monitored-org']);
    delete process.env.STOR24_ALERT_ORGANISATION_ID; assert.equal((await f.GET()).status, 403); assert.equal(f.reads.length, 1);
  } finally { if (prior === undefined) delete process.env.STOR24_ALERT_ORGANISATION_ID; else process.env.STOR24_ALERT_ORGANISATION_ID = prior; }
});
test('actual dashboard aggregation scopes database reads, strips private data and preserves partial evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stor24-dashboard-')); const previous = process.env.DLP_BACKUP_STATUS_PATH; process.env.DLP_BACKUP_STATUS_PATH = root;
  try {
    await writeFile(path.join(root, 'operations.json'), JSON.stringify({ checkedAt: new Date().toISOString(), diskUsedPercent: 86, memoryAvailablePercent: 55, appHealth: 'healthy', oomKilled: false, image: 'stor24-crm:1234567', databaseConnections: 9, databaseLimit: 100, password: 'private-secret' }));
    const bundle = await build({ stdin: { contents: 'export {operationsDiagnostics} from "./src/lib/operations-diagnostics";export {state} from "@/lib/db";', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'isolated-reads', setup(b) {
      b.onResolve({ filter: /^@\/lib\/(db|dlp-backup-status|operations-alerts)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('/db') ? 'export const state={reads:[],fail:false};const scoped=async(input)=>{state.reads.push(input.where);return [{status:"FAILED",_count:2}]};export const db={$queryRaw:async()=>{if(state.fail)throw Error("private-secret");return [{}]},integrationConnection:{findMany:async(input)=>{state.reads.push(input.where);return [{provider:"private-provider",status:"DISCONNECTED",lastHealthAt:null,config:"private-secret"}]}},webhookInbox:{groupBy:scoped},webhookOutbox:{groupBy:scoped}};' : args.path.endsWith('operations-alerts') ? 'export async function readOperationsAlerts(){return {recipients:[{enabled:true,email:"private@example.invalid"}]}}' : 'export async function dlpBackupStatus(){return {fresh:true,completedAt:new Date().toISOString(),restoredAt:null,offSite:false}}' }));
    } }] });
    const f = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const data = await f.operationsDiagnostics('only-this-org'); assert.ok(f.state.reads.every(where => where.organisationId === 'only-this-org')); assert.equal(data.cards.find(c => c.id === 'disk').state, 'critical'); assert.equal(data.activeRecipients, 1); assert.equal(data.queues.incoming.failed, 2); assert.equal(data.connections[0].provider, 'Other integration'); assert.ok(!JSON.stringify(data).includes('private'));
    f.state.fail = true; await writeFile(path.join(root, 'operations.json'), '{broken'); const partial = await f.operationsDiagnostics('only-this-org'); assert.equal(partial.cards.find(c => c.id === 'database').state, 'critical'); assert.equal(partial.cards.find(c => c.id === 'disk').state, 'unknown'); assert.equal(partial.cards.find(c => c.id === 'backup').state, 'good'); assert.equal(partial.queues.outgoing.failed, 2);
  } finally { if (previous === undefined) delete process.env.DLP_BACKUP_STATUS_PATH; else process.env.DLP_BACKUP_STATUS_PATH = previous; await rm(root, { recursive: true }); }
});

test('diagnostic download audits owner-scoped content and blocks release on audit failure', async () => {
  const prior=process.env.STOR24_ALERT_ORGANISATION_ID;process.env.STOR24_ALERT_ORGANISATION_ID='monitored-org';
  try {
    const f=await apiFixture();f.setOwner('monitored-org');f.guardState.fail=false;f.guardState.records.length=0;
    const request=()=>new Request('https://example.invalid/api/v1/operations/diagnostics?export=json');
    const response=await f.GET(request());assert.equal(response.status,200);
    assert.match(response.headers.get('content-disposition'),/stor24-troubleshooting.json/);
    assert.deepEqual((await response.json()).cards,[]);
    assert.equal(f.guardState.records[0].actorId,'synthetic-owner');assert.equal(f.guardState.records[0].organisationId,'monitored-org');
    f.guardState.fail=true;const denied=await f.GET(request());assert.equal(denied.status,500);assert.doesNotMatch(await denied.text(),/cards|AUDIT_DOWN/);
    f.guardState.fail=false;
  } finally { if(prior===undefined)delete process.env.STOR24_ALERT_ORGANISATION_ID;else process.env.STOR24_ALERT_ORGANISATION_ID=prior; }
});
