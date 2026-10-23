import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker from '../scripts/external-monitor-worker.mjs';

test('independent trigger dispatches only the fixed main monitor with no test alerts or redirects', async t => {
  const calls = [];
  t.mock.method(console, 'info', (...args) => calls.push(args));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/blendproperty/stor24-portal/actions/workflows/monitor-production.yml/dispatches');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
    assert.deepEqual(JSON.parse(options.body), { ref: 'main', inputs: { test_alert: false } });
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(null, { status: 204 });
  });
  await worker.scheduled({}, { GITHUB_MONITOR_TOKEN: 'synthetic-test-token' });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
  assert.deepEqual(calls, [['STOR24 monitor dispatch accepted', 204]]);
});

test('missing credentials, HTTP rejection and uncertain requests fail without replay or secret logging', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('private provider body', { status: 403 }));
  await assert.rejects(worker.scheduled({}, {}), /Missing GitHub monitor token/);
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(worker.scheduled({}, { GITHUB_MONITOR_TOKEN: 'synthetic-test-token' }), { message: 'GitHub monitor dispatch failed: HTTP 403' });
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => { throw new Error('synthetic-test-token'); });
  await assert.rejects(worker.scheduled({}, { GITHUB_MONITOR_TOKEN: 'synthetic-test-token' }), { message: 'GitHub monitor dispatch request failed; no automatic replay' });
  assert.equal(fetch.mock.callCount(), 2);
});

test('worker is cron-only with six ten-minute slots and no credential in its configuration', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.monitor.json', import.meta.url), 'utf8'));
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.equal(worker.fetch, undefined); assert.equal(config.routes, undefined); assert.equal(config.vars, undefined);
  assert.deepEqual(config.triggers.crons, ['3,13,23,33,43,53 * * * *']);
  assert.equal(config.main, 'scripts/external-monitor-worker.mjs');
});
