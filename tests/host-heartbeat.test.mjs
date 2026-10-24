import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveMonitor } from '../scripts/write-monitor-status.mjs';
import worker from '../scripts/external-monitor-worker.mjs';
import { safeHeartbeat, freshHeartbeat, monitorRequest, HEARTBEAT_URL } from '../scripts/host-heartbeat-policy.mjs';
import { collectHostHeartbeat, publishHostHeartbeat } from '../scripts/host-heartbeat.mjs';
import { checkHostHeartbeat } from '../scripts/check-host-heartbeat.mjs';
import { backupEvidence } from '../scripts/production-alert-details.mjs';

const key = 'a'.repeat(64);
const healthy = () => ({ version: 1, checkedAt: new Date().toISOString(), backup: 'success', resources: 'success', markers: [] });
function fixture() {
  const data = new Map(); let writes = 0;
  const env = { STOR24_HEARTBEAT_KEY: key, MONITOR_EVIDENCE: { get: async k => data.has(k) ? JSON.parse(data.get(k)) : null, put: async (k,v) => { writes++; data.set(k,v); } } };
  const fetcher = (url, options) => worker.fetch(new Request(url, options), env);
  return { env, fetcher, data, writes: () => writes };
}
test('actual host collector, authenticated external store, independent checker and dashboard pull work together without SSH', async t => {
  t.mock.method(console, 'info', () => {});
  const f = fixture(); const commands = []; const saved = [];
  const run = (command, args, options) => { commands.push({command,args,options}); return { status: 0, stdout: '' }; };
  const entry = { runId: '12345', checkedAt: new Date().toISOString(), readiness: 'success', backup: 'success', status: 'HEALTHY_NO_NOTIFICATION', privateEmail: 'private@example.invalid' };
  await monitorRequest(f.env, 'dashboard', { method: 'POST', body: entry, fetcher: f.fetcher });
  await publishHostHeartbeat(f.env, { run, fetcher: f.fetcher, save: async e => saved.push(e) });
  assert.deepEqual(await checkHostHeartbeat(f.env, f.fetcher), { ok: true, markers: ['STOR24_HOST_CHECKS_OK'] });
  assert.equal(commands.length, 2); assert.ok(commands.every(c => c.command === '/bin/bash' && c.options.timeout === 25000));
  assert.equal(saved[0].runId, '12345'); assert.equal(saved[0].privateEmail, undefined);
  assert.ok(![...f.data.values()].join('').includes('private@example.invalid'));
});
test('missing, malformed, stale and future heartbeats fail closed; missing check does not claim a failed backup', async () => {
  const f = fixture();
  assert.equal((await checkHostHeartbeat(f.env, f.fetcher)).ok, false);
  for (const delta of [-16 * 60_000, 120_000]) {
    const checkedAt = new Date(Date.now() + delta).toISOString();
    f.data.set('host', JSON.stringify({ receivedAt: checkedAt, report: { ...healthy(), checkedAt } }));
    assert.deepEqual(await checkHostHeartbeat(f.env, f.fetcher), { ok: false, markers: ['STOR24_HOST_HEARTBEAT_MISSING'] });
  }
  assert.equal(freshHeartbeat({ receivedAt: new Date().toISOString(), report: { ...healthy(), backup: 'failure' } }), null);
  const finding = backupEvidence('STOR24_HOST_HEARTBEAT_MISSING');
  assert.equal(finding.severity, 'WARNING'); assert.match(finding.impact, /no backup failure or website outage/);
});
test('local checks run independently, preserve concrete failures and strip raw output', () => {
  let call = 0;
  const report = collectHostHeartbeat(() => ++call === 1 ? { status: 1, stdout: 'private-error\n' } : { status: 1, stdout: 'HOST_DISK_THRESHOLD\nprivate-error' });
  assert.equal(call, 2); assert.equal(report.backup, 'failure'); assert.equal(report.resources, 'failure');
  assert.deepEqual(report.markers, ['STOR24_BACKUP_FAILED', 'STOR24_RESOURCES_FAILED', 'HOST_DISK_THRESHOLD']);
  assert.ok(!JSON.stringify(report).includes('private-error'));
  assert.match(backupEvidence(report.markers.join('\n')).failure, /backup and server resource/);
  const unknown = collectHostHeartbeat(() => ({ status: null, error: new Error('private credentials') }));
  assert.equal(unknown.backup, 'unknown'); assert.equal(unknown.resources, 'unknown');
  assert.equal(backupEvidence(unknown.markers.join('\n')).severity, 'WARNING');
  assert.equal(safeHeartbeat({ ...healthy(), markers: ['password=private'] }), null);
  assert.equal(safeHeartbeat({ ...healthy(), resources: 'failure', markers: ['STOR24_BACKUP_FAILED', 'STOR24_RESOURCES_FAILED'] }), null);
});
test('unauthenticated calls cannot read or write, invalid paths and methods are refused', async () => {
  const f = fixture();
  for (const path of ['host', 'dashboard']) {
    assert.equal((await worker.fetch(new Request(`${HEARTBEAT_URL}/${path}`), f.env)).status, 401);
    assert.equal((await worker.fetch(new Request(`${HEARTBEAT_URL}/${path}`, { method: 'POST', body: JSON.stringify(healthy()), headers: { Authorization: `Bearer ${'b'.repeat(64)}` } }), f.env)).status, 401);
  }
  assert.equal(f.writes(), 0);
  assert.equal((await worker.fetch(new Request(`${HEARTBEAT_URL}/other`), f.env)).status, 404);
  assert.equal((await f.fetcher(`${HEARTBEAT_URL}/host`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } })).status, 405);
});
test('uploads are size bounded, validated, fresh and idempotent; stale replay cannot reset age', async () => {
  const f = fixture(); const report = healthy();
  await monitorRequest(f.env, 'host', { method: 'POST', body: report, fetcher: f.fetcher });
  const first = f.data.get('host');
  await monitorRequest(f.env, 'host', { method: 'POST', body: report, fetcher: f.fetcher });
  assert.equal(f.writes(), 1); assert.equal(f.data.get('host'), first);
  for (const input of [{ ...report, checkedAt: new Date(Date.now() - 120_000).toISOString() }, { ...report, checkedAt: new Date(Date.now() + 120_000).toISOString() }, { ...report, markers: ['RAW_LOG_SECRET'] }, { ...report, padding: 'x'.repeat(24000) }]) {
    await assert.rejects(monitorRequest(f.env, 'host', { method: 'POST', body: input, fetcher: f.fetcher }));
  }
  const older = { ...report, checkedAt: new Date(Date.parse(report.checkedAt) - 1).toISOString() };
  await assert.rejects(monitorRequest(f.env, 'host', { method: 'POST', body: older, fetcher: f.fetcher }));
  assert.equal(f.writes(), 1);
});
test('report store and transport failures are monitoring warnings, not false backup failures', async () => {
  const f = fixture(); f.env.MONITOR_EVIDENCE.get = async () => { throw new Error('private'); };
  assert.deepEqual(await checkHostHeartbeat(f.env, f.fetcher), { ok: false, markers: ['STOR24_HOST_REPORT_UNAVAILABLE'] });
  assert.equal(backupEvidence('STOR24_HOST_REPORT_UNAVAILABLE').severity, 'WARNING');
  await assert.rejects(monitorRequest({}, 'host', { fetcher: async () => { throw Error('must not call'); } }), /AUTH_CONFIGURATION/);
  await assert.rejects(monitorRequest(f.env, 'host', { fetcher: async (_url, opts) => { assert.equal(opts.redirect, 'error'); assert.ok(opts.signal); throw Error('offline'); } }));
});
test('deployment installs a local bounded timer and routine workflow contains no SSH or host key', () => {
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const workflow = read('../.github/workflows/monitor-production.yml');
  assert.doesNotMatch(workflow, /VPS_SSH_KEY|VPS_HOST|\bssh\b/);
  assert.match(read('../docs/stor24-host-heartbeat.timer'), /OnBootSec=45s/);
  assert.match(read('../docs/stor24-host-heartbeat.timer'), /OnUnitActiveSec=5min/);
  assert.match(read('../docs/stor24-host-heartbeat.service'), /TimeoutStartSec=130/);
  assert.match(read('../docs/stor24-host-heartbeat.service'), /EnvironmentFile=\/etc\/stor24-monitor.env/);
  assert.doesNotMatch(read('../scripts/host-heartbeat.mjs'), /readFile/);
  assert.match(read('../.github/workflows/deploy-vps.yml'), /scripts\/install-host-heartbeat.sh/);
  assert.match(read('../scripts/install-host-heartbeat.sh'), /systemctl start stor24-host-heartbeat.service/);
});

test('safe evidence requests retry transient failure twice at most and never retry authentication rejection', async () => {
  let calls = 0;
  const f = fixture();
  await monitorRequest(f.env, 'host', { fetcher: async () => { if (++calls === 1) throw Error('private-network-error'); return Response.json({ report: null }); } });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(monitorRequest(f.env, 'host', { fetcher: async () => { calls++; return Response.json({}, { status: 401 }); } }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(monitorRequest(f.env, 'host', { fetcher: async () => { calls++; return Response.json({}, { status: 503 }); } }));
  assert.equal(calls, 2);
});

test('local service writes sanitized dashboard evidence readable by the non-root app container', { skip: process.platform === 'win32' }, async () => {
  const service = readFileSync(new URL('../docs/stor24-host-heartbeat.service', import.meta.url), 'utf8');
  const root = await mkdtemp(join(tmpdir(), 'stor24-heartbeat-'));
  const previous = process.umask(parseInt(service.match(/^UMask=([0-7]+)$/m)[1], 8));
  try {
    await saveMonitor({ runId: '12345', checkedAt: new Date().toISOString(), readiness: 'success', backup: 'success', status: 'HEALTHY_NO_NOTIFICATION' }, root);
    assert.equal((await stat(join(root, 'monitor.json'))).mode & 0o777, 0o644);
  } finally { process.umask(previous); await rm(root, { recursive: true, force: true }); }
});
