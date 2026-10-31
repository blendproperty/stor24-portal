import assert from 'node:assert/strict';
import test from 'node:test';
import { readMonitorHistory, MonitorHistoryError, safeAlertFailure } from '../scripts/send-production-alert.mjs';

test('transient read-only network/429/5xx history failures retry once and then recover', async () => {
  for (const first of ['network', 'body', 429, 500, 503]) {
    let calls = 0, waits = 0;
    const actual = await readMonitorHistory('https://api.github.com/repos/example/repo/actions/history', {}, async (_url, options) => {
      calls++; assert.equal(options.method, 'GET'); assert.ok(options.signal instanceof AbortSignal);
      if (calls === 1) {
        if (first === 'network') throw Error('PRIVATE');
        if (first === 'body') return { ok: true, json: async () => { throw Error('PRIVATE_BODY_RESET'); } };
        return new Response('{}', { status: first });
      }
      return Response.json({ workflow_runs: [] });
    }, { wait: async ms => { assert.equal(ms, 500); waits++; } });
    assert.equal(calls, 2); assert.equal(waits, 1); assert.deepEqual(actual, { workflow_runs: [] });
  }
});

test('authentication, missing resources and malformed successful JSON do not retry or leak raw evidence', async () => {
  for (const status of [401, 403, 404, 200]) {
    let calls = 0;
    await assert.rejects(readMonitorHistory('https://api.github.com/example', {}, async () => { calls++; return new Response('PRIVATE-TOKEN-AND-BODY', { status }); }, { stage: 'JOBS', wait: async () => { throw Error('MUST_NOT_WAIT'); } }), error => {
      assert.equal(error.stage, 'HISTORY_JOBS'); assert.equal(error.attempts, 1);
      assert.equal(error.code, status === 200 ? 'INVALID_JSON' : 'HTTP'); assert.doesNotMatch(JSON.stringify(error), /PRIVATE/); return true;
    });
    assert.equal(calls, 1);
  }
});

test('persistent history transport failures remain bounded and stage-specific', async () => {
  let calls = 0;
  await assert.rejects(readMonitorHistory('https://api.github.com/example', {}, async () => { calls++; throw Error('PRIVATE-TOKEN'); }, { wait: async () => {} }), error => {
    assert.equal(error.stage, 'HISTORY_RUNS'); assert.equal(error.code, 'TRANSPORT'); assert.equal(error.attempts, 2); return true;
  });
  assert.equal(calls, 2);
});

test('diagnostics allow only fixed stages/codes and bounded attempts/status, never supplied private strings', () => {
  const diagnostic = safeAlertFailure(new MonitorHistoryError('PRIVATE_STAGE', 'PRIVATE_TOKEN', 99, 9999), 'DISPATCH');
  assert.deepEqual(diagnostic, { stage: 'HISTORY', code: 'UNEXPECTED', attempts: 0 });
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE/);
  assert.deepEqual(safeAlertFailure(Error('PRIVATE_PATH'), 'PRIVATE_STAGE'), { stage: 'DISPATCH', code: 'UNEXPECTED' });
});
