import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { probeReadiness, resolveReadiness } from '../scripts/check-production-readiness.mjs';

const healthy = { state: 'healthy', markers: ['STOR24_READINESS_OK'] };
const timeout = { state: 'unverified', markers: ['STOR24_ORIGIN_UNVERIFIED host=stor24.co.za probe=plain curl=28 attempts=3'] };
const bypass = { state: 'failed', markers: ['STOR24_ORIGIN_FAILED host=stor24.co.za probe=plain http=200'] };

test('independent confirmation recovers only connection failures, never real failed validation', () => {
  assert.deepEqual(resolveReadiness(timeout, healthy), healthy);
  assert.deepEqual(resolveReadiness(timeout, bypass), bypass);
  assert.deepEqual(resolveReadiness(bypass, healthy), bypass);
  assert.deepEqual(resolveReadiness(timeout, timeout), timeout);
  for (const missing of [undefined, '', '{}', JSON.stringify({ ...healthy, markers: ['PRIVATE'] }), JSON.stringify({ ...healthy, markers: timeout.markers })]) {
    assert.equal(resolveReadiness(timeout, missing).state, 'failed');
    assert.equal(resolveReadiness(missing, healthy).state, 'failed');
  }
  assert.equal(resolveReadiness({ ...timeout, markers: bypass.markers }, healthy).state, 'failed');
});

test('actual probe runs both checks, classifies curl transport separately and sanitizes unknown failures', () => {
  let calls = [];
  assert.deepEqual(probeReadiness((command, args) => { calls.push([command, ...args]); return { status: 0 }; }), healthy);
  assert.deepEqual(calls, [['bash', 'scripts/public-readiness.sh'], ['bash', 'scripts/origin-access-health.sh']]);
  for (const code of [6, 7, 28, 35, 52, 56, 22, 60]) {
    const result = probeReadiness(() => ({ status: code, stderr: `PRIVATE_RESPONSE\nSTOR24_PUBLIC_UNAVAILABLE curl=${code}\n` }));
    assert.equal(result.state, [22, 60].includes(code) ? 'failed' : 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  assert.equal(probeReadiness(() => ({ status: 1, stderr: 'STOR24_PUBLIC_FAILED check=database\n' })).state, 'failed');
  assert.deepEqual(probeReadiness(() => ({ status: null, error: new Error('PRIVATE') })), { state: 'failed', markers: ['STOR24_READINESS_INCOMPLETE'] });
});

test('real curl retries discard a partial health response instead of concatenating JSON', async () => {
  let requests = 0;
  const body = JSON.stringify({ service: 'stor24-crm', status: 'ok', database: 'ok' });
  const server = createServer((request, response) => {
    requests++;
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Connection: 'close' });
    if (requests === 1) {
      response.write(body.slice(0, 24));
      response.flushHeaders();
      setTimeout(() => response.destroy(), 30);
    } else response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
    const child = spawn(bash, ['scripts/public-readiness.sh'], { env: { ...process.env, HEALTH_URL: `http://127.0.0.1:${server.address().port}`, EXPECT_MERCHANDISE_WORKER: 'false' } });
    let output = '';
    child.stdout.on('data', value => { output += value; });
    child.stderr.on('data', value => { output += value; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, output);
    assert.equal(requests, 2);
    assert.doesNotMatch(output, /STOR24_PUBLIC_FAILED|stor24-crm/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('workflow gates confirmation on unverified evidence and alerts on final readiness, not the first network path', () => {
  const workflow = readFileSync('.github/workflows/monitor-production.yml', 'utf8').replaceAll('\r\n', '\n');
  assert.match(workflow, /needs\.readiness-primary\.outputs\.state == 'unverified'/);
  assert.match(workflow, /readiness-confirmation:[\s\S]*?runs-on: macos-latest/);
  assert.match(workflow, /readiness:\n    if: always\(\)\n    needs: \[readiness-primary, readiness-confirmation\]/);
  assert.match(workflow, /READINESS_RESULT: \$\{\{ needs\.readiness\.result \}\}/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});
