import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { executeProductionAlert } from '../scripts/send-production-alert.mjs';

const base = { GITHUB_REPOSITORY: 'blendproperty/stor24-portal', GITHUB_RUN_ID: '10', READINESS_RESULT: 'success', BACKUP_RESULT: 'success', ALERT_TEST: 'false' };
const recipientLoader = async () => ({ source: 'EMERGENCY_DEFAULTS', recipients: null });

test('persistent history failure produces a diagnostic artifact and nonzero result without sending', async t => {
  let sends = 0, calls = 0; const saved = [];
  t.mock.method(nodemailer, 'createTransport', () => { sends++; throw Error('MUST_NOT_SEND'); });
  const actual = await executeProductionAlert(base, { recipientLoader, writeReport: async value => saved.push(value), fetcher: async () => { calls++; return new Response('PRIVATE-BODY', { status: 503 }); } });
  assert.equal(calls, 2); assert.equal(sends, 0); assert.equal(actual.exitCode, 1); assert.equal(actual.persisted, true);
  assert.equal(saved.length, 1); assert.equal(saved[0].status, 'UNAVAILABLE'); assert.equal(saved[0].automaticReplay, false); assert.equal(saved[0].deliveryState, 'NOT_ATTEMPTED');
  assert.deepEqual(saved[0].diagnostic, { stage: 'HISTORY_RUNS', code: 'HTTP', attempts: 2, httpStatus: 503 });
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE-BODY/);
});

test('transient history failure recovers to healthy silence and publishes a normal result', async () => {
  let calls = 0; const saved = [];
  const actual = await executeProductionAlert(base, { recipientLoader, writeReport: async value => saved.push(value), fetcher: async () => { calls++; return calls === 1 ? new Response('{}', { status: 503 }) : Response.json({ workflow_runs: [] }); } });
  assert.equal(calls, 2); assert.equal(actual.exitCode, 0); assert.equal(saved[0].status, 'HEALTHY_NO_NOTIFICATION');
});

test('permanent previous-job history rejection is stage-specific, not retried, and does not send', async () => {
  let calls = 0; const saved = [];
  const result = await executeProductionAlert(base, { recipientLoader, writeReport: async report => saved.push(report), fetcher: async url => {
    calls++; return url.includes('/workflows/') ? Response.json({ workflow_runs: [{ id: 9 }] }) : new Response('PRIVATE_AUTH_BODY', { status: 403 });
  } });
  assert.equal(calls, 2); assert.equal(result.exitCode, 1); assert.equal(saved[0].deliveryState, 'NOT_ATTEMPTED');
  assert.deepEqual(saved[0].diagnostic, { stage: 'HISTORY_JOBS', code: 'HTTP', attempts: 1, httpStatus: 403 });
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_AUTH_BODY/);
});

test('unexpected recipient-loader error is redacted and records that no provider attempt occurred', async () => {
  const saved = [];
  const result = await executeProductionAlert(base, { recipientLoader: async () => { throw Error('PRIVATE_KEY_PATH'); }, writeReport: async report => saved.push(report), fetcher: () => { throw Error('MUST_NOT_FETCH'); } });
  assert.equal(result.exitCode, 1); assert.equal(saved[0].deliveryState, 'NOT_ATTEMPTED');
  assert.deepEqual(saved[0].diagnostic, { stage: 'RECIPIENTS', code: 'UNEXPECTED' }); assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_KEY_PATH/);
});

test('workflow rerun still skips every history request and provider send', async () => {
  const result = await executeProductionAlert({ ...base, GITHUB_RUN_ATTEMPT: '2', ALERT_TEST: 'true' }, { recipientLoader, writeReport: async () => {}, fetcher: () => { throw Error('MUST_NOT_FETCH_OR_SEND'); } });
  assert.equal(result.report.status, 'SKIPPED_REPLAY'); assert.equal(result.exitCode, 0);
});

test('uncertain SMTP send occurs once and is recorded; history retry never wraps provider calls', async t => {
  let sends = 0; const saved = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, async sendMail() { sends++; throw Error('PRIVATE_SMTP_ACCEPTANCE_UNCERTAIN'); } }));
  const result = await executeProductionAlert({ ...base, READINESS_RESULT: 'failure', ALERT_CHANNELS: 'EMAIL', ALERT_EMAIL_TO: 'synthetic@example.invalid', HOSTINGER_SMTP_PASSWORD: 'synthetic' }, {
    recipientLoader, writeReport: async value => saved.push(value), fetcher: async url => Response.json(url.includes('/workflows/') ? { workflow_runs: [] } : { jobs: [] }),
  });
  assert.equal(sends, 1); assert.equal(result.exitCode, 1); assert.equal(saved[0].status, 'ATTEMPTED'); assert.equal(saved[0].results[0].status, 'UNCERTAIN');
  assert.equal(saved[0].results[0].automaticRetry, false); assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_SMTP/);
});

test('artifact write failure after delivery does not replay provider or disguise uncertainty', async t => {
  let sends = 0, writes = 0; const saved = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, async sendMail(message) { sends++; return { accepted: [message.to], rejected: [] }; } }));
  const result = await executeProductionAlert({ ...base, READINESS_RESULT: 'failure', ALERT_CHANNELS: 'EMAIL', ALERT_EMAIL_TO: 'synthetic@example.invalid', HOSTINGER_SMTP_PASSWORD: 'synthetic' }, {
    recipientLoader, writeReport: async value => { if (++writes === 1) throw Error('PRIVATE-DISK-PATH'); saved.push(value); },
    fetcher: async url => Response.json(url.includes('/workflows/') ? { workflow_runs: [] } : { jobs: [] }),
  });
  assert.equal(sends, 1); assert.equal(result.exitCode, 1); assert.equal(saved[0].status, 'UNAVAILABLE'); assert.equal(saved[0].deliveryState, 'MAY_HAVE_OCCURRED');
  assert.deepEqual(saved[0].diagnostic, { stage: 'REPORT', code: 'UNEXPECTED' }); assert.doesNotMatch(JSON.stringify(saved), /PRIVATE-DISK-PATH/);
});

test('actual CLI preserves a diagnostic artifact for the reproduced healthy-check/history503 failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stor24-history-503-'));
  const preload = "globalThis.fetch = async (_url, options) => { if (options?.method !== 'GET') throw Error('NO_PROVIDER_WRITES'); return new Response('PRIVATE-BODY', {status:503}); };";
  try {
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`, fileURLToPath(new URL('../scripts/send-production-alert.mjs', import.meta.url))], {
      cwd: directory, env: { ...process.env, ...base, GITHUB_RUN_ATTEMPT: '1', STOR24_ALERT_CONFIG_KEY: '', HOSTINGER_SMTP_PASSWORD: '', TWILIO_AUTH_TOKEN: '' }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(await readFile(join(directory, 'production-alert-result.json'), 'utf8'));
    assert.equal(report.status, 'UNAVAILABLE'); assert.equal(report.deliveryState, 'NOT_ATTEMPTED');
    assert.equal(report.diagnostic.stage, 'HISTORY_RUNS'); assert.equal(report.diagnostic.attempts, 2);
    assert.doesNotMatch(result.stdout + result.stderr + JSON.stringify(report), /PRIVATE-BODY/);
    const publisherPreload = `globalThis.fetch = async (url, options) => {
      if (url !== 'https://portal.stor24.co.za/_operations/monitor/dashboard' || options.method !== 'POST') throw Error('NO_OTHER_REQUESTS');
      const entry = JSON.parse(options.body);
      if (entry.status !== 'UNAVAILABLE' || entry.readiness !== 'success' || entry.backup !== 'success') throw Error('WRONG_EVIDENCE');
      return Response.json({accepted:true});
    };`;
    const published = spawnSync(process.execPath, ['--import', `data:text/javascript;base64,${Buffer.from(publisherPreload).toString('base64')}`, fileURLToPath(new URL('../scripts/publish-monitor-evidence.mjs', import.meta.url))], {
      cwd: directory, env: { ...process.env, ...base, STOR24_HEARTBEAT_KEY: 'a'.repeat(64) }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(published.status, 0, published.stderr);
    assert.match(published.stdout, /Aggregate monitoring evidence published/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
