import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decryptRecipients } from '../scripts/load-alert-recipients.mjs';
import { planNotification, preflight } from '../scripts/plan-production-alert.mjs';

const base = { GITHUB_RUN_ID: '10', GITHUB_REPOSITORY: 'blendproperty/stor24-portal', READINESS_RESULT: 'success', BACKUP_RESULT: 'success' };
function history({ readiness = 'success', backup = 'success', sender = 'skipped', age = 0 } = {}) {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.method, undefined); // Planning cannot contact notification providers or write anything.
    assert.ok(url.startsWith('https://api.github.com/repos/blendproperty/stor24-portal/actions/'));
    return Response.json(url.includes('/jobs?') ? { jobs: [
      { name: 'readiness', conclusion: readiness }, { name: 'backup', conclusion: backup },
      { name: 'alerts', status: 'completed', conclusion: sender },
    ] } : { workflow_runs: [{ id: 9, created_at: new Date(Date.now() - age).toISOString() }] });
  };
  return { fetcher, urls };
}

test('healthy planning needs no email dependency or delivery runner', async () => {
  const h = history();
  assert.deepEqual(await preflight(base, h.fetcher), { status: 'HEALTHY_NO_NOTIFICATION' });
  assert.equal(h.urls.length, 2);
});

test('first outage, recovery, explicit test and unverified checks require the existing sender', async () => {
  for (const [env, prior, kind] of [
    [{ ...base, READINESS_RESULT: 'failure' }, {}, 'FAILURE'],
    [{ ...base, BACKUP_RESULT: 'failure' }, {}, 'FAILURE'],
    [{ ...base, BACKUP_RESULT: 'skipped' }, {}, 'FAILURE'],
    [base, { backup: 'failure', sender: 'success' }, 'RECOVERY'],
    [{ ...base, ALERT_TEST: 'true' }, {}, 'TEST'],
  ]) assert.deepEqual(await preflight(env, history(prior).fetcher), { status: 'DELIVERY_REQUIRED', kind });
});

test('skipping a silent sender does not consume cooldown; partial delivery does, until 30 minutes', async () => {
  const failed = { ...base, READINESS_RESULT: 'failure' };
  assert.equal((await preflight(failed, history({ readiness: 'failure' }).fetcher)).status, 'DELIVERY_REQUIRED');
  assert.equal((await preflight(failed, history({ readiness: 'failure', sender: 'failure' }).fetcher)).status, 'SUPPRESSED');
  assert.equal((await preflight(failed, history({ readiness: 'failure', sender: 'failure', age: 31 * 60000 }).fetcher)).status, 'DELIVERY_REQUIRED');
});

test('history rejection, transport errors and incomplete results cannot silence the sender', async () => {
  for (const fetcher of [
    async () => { throw Error('private-token'); },
    async () => new Response('private', { status: 403 }),
    async () => Response.json({}),
    async url => Response.json(url.includes('/jobs?') ? { jobs: [] } : { workflow_runs: [{ id: 9 }] }),
  ]) {
    assert.deepEqual(await preflight(base, fetcher), { status: 'DELIVERY_REQUIRED', reason: 'HISTORY_UNAVAILABLE' });
    await assert.rejects(planNotification(base, fetcher));
  }
});

test('workflow reruns cannot replay notifications', async () => {
  const plan = await preflight({ ...base, GITHUB_RUN_ATTEMPT: '2', ALERT_TEST: 'true' }, () => { throw Error('must not fetch'); });
  assert.equal(plan.status, 'SKIPPED_REPLAY');
});

test('recorded host failure remains a failure; rollback to the original CLI exits nonzero', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stor24-alert-plan-'));
  try {
    const output = join(directory, 'output');
    const env = { ...process.env, STOR24_HEARTBEAT_KEY: '', GITHUB_OUTPUT: output };
    const recorded = spawnSync(process.execPath, ['scripts/check-host-heartbeat.mjs', '--record-outcome'], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'result=failure\n');
    assert.match(recorded.stdout, /STOR24_HOST_REPORT_UNAVAILABLE/);
    const legacy = spawnSync(process.execPath, ['scripts/check-host-heartbeat.mjs'], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(legacy.status, 1, legacy.stderr);
    const restored = spawnSync(process.execPath, ['-e', "if (process.env.HOST_RESULT !== 'success') process.exit(1)"], { env: { ...env, HOST_RESULT: 'failure' }, timeout: 5000 });
    assert.equal(restored.status, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the real healthy CLI refreshes encrypted recipients and publishes a silent result without provider calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stor24-alert-silent-'));
  const key = 'a'.repeat(64);
  const recipient = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic owner', email: 'owner@example.invalid', mobile: '', channels: ['EMAIL'], enabled: true, consent: true };
  const preload = `globalThis.fetch = async url => {
    if (url === 'https://api.github.com/repos/blendproperty/stor24-portal/actions/workflows/monitor-production.yml/runs?status=completed&per_page=10') return Response.json({ workflow_runs: [] });
    if (url === 'https://portal.stor24.co.za/api/v1/operations/alert-monitor-config') return Response.json({ data: { recipients: ${JSON.stringify([recipient])} } });
    throw new Error('Unexpected request: ' + url);
  };`;
  try {
    const output = join(directory, 'output');
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`, fileURLToPath(new URL('../scripts/plan-production-alert.mjs', import.meta.url))], {
      cwd: directory, env: { ...process.env, ...base, GITHUB_RUN_ATTEMPT: '1', STOR24_ALERT_CONFIG_KEY: key, GITHUB_OUTPUT: output }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(directory, 'production-alert-result.json'), 'utf8'));
    assert.equal(report.status, 'HEALTHY_NO_NOTIFICATION');
    assert.equal(report.recipientSource, 'SAVED_RECIPIENTS');
    assert.equal(readFileSync(output, 'utf8'), 'notify=false\n');
    const encrypted = readFileSync(join(directory, '.operations-alert-config.enc'), 'utf8');
    assert.deepEqual(decryptRecipients(encrypted, key), [recipient]);
    assert.doesNotMatch(encrypted + result.stdout, /owner@example.invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('workflow keeps independent evidence, fail-open sender gating and actual host failure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/monitor-production.yml', import.meta.url), 'utf8');
  const backup = workflow.split('  backup:')[1].split('  alerts:')[0];
  const alerts = workflow.split('  alerts:')[1];
  assert.match(backup, /runs-on: macos-latest/);
  assert.match(backup, /needs: readiness/);
  assert.match(backup, /STOR24_ALERT_CONFIG_KEY/);
  assert.match(backup, /Restore encrypted last-known recipients/);
  assert.match(backup, /job.status != 'success'/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.match(backup, /steps.plan.outcome != 'success'/);
  assert.match(backup, /steps.publish.outcome == 'failure'/);
  assert.match(backup, /HOST_RESULT: \$\{\{ steps.heartbeat.outputs.result \}\}/);
  assert.match(backup, /process.env.HOST_RESULT !== 'success'/);
  assert.doesNotMatch(backup, /npm ci|SMTP_PASSWORD|TWILIO_AUTH_TOKEN/);
  assert.match(alerts, /always\(\) && needs.backup.outputs.notify != 'false'/);
  assert.match(alerts, /npm ci --omit=dev --ignore-scripts --no-audit --no-fund/);
  assert.match(alerts, /BACKUP_RESULT: \$\{\{ needs.backup.result \}\}/);
  assert.match(alerts, /Restore encrypted last-known recipients/);
});
