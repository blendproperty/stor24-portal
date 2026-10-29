import test from 'node:test';
import assert from 'node:assert/strict';
import { pingMonitorWatchdog } from '../scripts/ping-monitor-watchdog.mjs';

const url = 'https://hc-ping.com/00000000-0000-0000-0000-000000000001';
const env = { STOR24_WATCHDOG_PING_URL: url, READINESS_RESULT: 'success', BACKUP_RESULT: 'success', MONITOR_JOB_RESULT: 'success' };

test('only the configured single-check HTTPS destination is accepted', async () => {
  for (const value of ['', 'http://hc-ping.com/00000000-0000-0000-0000-000000000001', url + '?data=secret', url + '#secret', url + '/fail', url.replace('hc-ping.com', 'hc-ping.com.attacker.invalid'), url.replace('hc-ping.com', 'user:password@hc-ping.com')]) {
    await assert.rejects(pingMonitorWatchdog({ ...env, STOR24_WATCHDOG_PING_URL: value }, () => assert.fail('network must not be contacted')), /CONFIGURATION_REQUIRED/);
  }
});

test('successful completion sends no log, credential header or request body', async () => {
  let calls = 0;
  assert.equal(await pingMonitorWatchdog(env, async (address, options) => {
    calls++; assert.equal(address, url); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { 'User-Agent': 'STOR24-monitor-watchdog' });
    assert.ok(options.signal instanceof AbortSignal); return new Response('OK');
  }), 'STOR24_WATCHDOG_SUCCESS_PUBLISHED');
  assert.equal(calls, 1);
});

test('failed, cancelled or skipped checks and failed alert publication cannot signal success', async () => {
  for (const key of ['READINESS_RESULT', 'BACKUP_RESULT', 'MONITOR_JOB_RESULT']) {
    for (const state of ['failure', 'cancelled', 'skipped']) {
      assert.equal(await pingMonitorWatchdog({ ...env, [key]: state }, async address => {
        assert.equal(address, url + '/fail'); return new Response('OK');
      }), 'STOR24_WATCHDOG_FAILURE_PUBLISHED');
    }
  }
});

test('missing or malformed job evidence never produces a healthy check-in', async () => {
  for (const state of [undefined, '', 'in_progress', 'unknown']) {
    await assert.rejects(pingMonitorWatchdog({ ...env, READINESS_RESULT: state }, () => assert.fail('no request')), /INVALID_RESULT/);
  }
});

test('provider rejection and transport errors are bounded and do not disclose or replay the secret', async () => {
  for (const status of [301, 401, 429, 500]) {
    let calls = 0;
    await assert.rejects(pingMonitorWatchdog(env, async () => { calls++; return new Response(null, { status }); }), /^Error: STOR24_WATCHDOG_REJECTED$/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(pingMonitorWatchdog(env, async () => { calls++; throw new Error(url); }), /^Error: STOR24_WATCHDOG_TRANSPORT_FAILED$/);
  assert.equal(calls, 1);
});
