import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
function probe(mode) {
  const root = mkdtempSync(join(tmpdir(), 'stor24-origin-'));
  try {
    writeFileSync(join(root, 'curl'), `#!/usr/bin/env bash
count=$(cat "$FIXTURE_ROOT/count" 2>/dev/null || echo 0)
echo $((count+1)) > "$FIXTURE_ROOT/count"
case "$MODE" in
  transient) [[ "$count" == 0 ]] && exit 28 ;;
  timeout) exit 28 ;;
  tls) exit 60 ;;
  bypass) printf 200; exit 0 ;;
  partial-bypass) printf 200; exit 28 ;;
  forbidden500) printf 500; exit 0 ;;
esac
printf 403
`, { mode: 0o755 });
    writeFileSync(join(root, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const result = spawnSync(bash, ['-c', 'cd "$FIXTURE_ROOT"; export FIXTURE_ROOT="$PWD"; export PATH="$PWD:$PATH"; bash "$PROBE_SCRIPT"'], {
      env: { ...process.env, MODE: mode, FIXTURE_ROOT: root.replaceAll('\\', '/'), PROBE_SCRIPT: resolve('scripts/origin-access-health.sh').replaceAll('\\', '/') },
      encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.ok(existsSync(join(root, 'count')), `Probe fixture did not run: ${result.status} ${result.stderr} ${result.stdout}`);
    return { ...result, calls: Number(readFileSync(join(root, 'count'), 'utf8')) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('origin checks recover transient transport errors and still run every plain/forged probe', () => {
  const result = probe('transient');
  assert.equal(result.status, 0, result.stderr); assert.equal(result.calls, 9);
  assert.match(result.stdout, /All four/);
});
test('exhausted connection attempts remain unverified and fail closed', () => {
  const result = probe('timeout');
  assert.equal(result.status, 28); assert.equal(result.calls, 3);
  assert.match(result.stderr, /STOR24_ORIGIN_UNVERIFIED host=stor24.co.za probe=plain curl=28 attempts=3/);
});
test('an observed origin HTTP 200 fails immediately even when curl times out reading its body', () => {
  const result = probe('partial-bypass');
  assert.equal(result.status, 1); assert.equal(result.calls, 1);
  assert.match(result.stderr, /STOR24_ORIGIN_FAILED host=stor24.co.za probe=plain http=200/);
  assert.doesNotMatch(result.stderr, /STOR24_ORIGIN_UNVERIFIED/);
});
test('unexpected HTTP responses and certificate failures are never retried or accepted', () => {
  for (const mode of ['bypass', 'forbidden500', 'tls']) {
    const result = probe(mode);
    assert.notEqual(result.status, 0); assert.equal(result.calls, 1);
    assert.match(result.stderr, mode === 'tls' ? /curl=60 attempts=1/ : /STOR24_ORIGIN_FAILED.*http=(200|500)/);
  }
});

test('the actual workflow health validator names each failed condition and never logs the response', () => {
  const workflow = readFileSync(resolve('scripts/public-readiness.sh'), 'utf8');
  const script = workflow.match(/node -e '([\s\S]*?)' "\$response"/)[1];
  const healthy = { service: 'stor24-crm', status: 'ok', database: 'ok', merchandiseExpiry: { enabled: true, status: 'ok' } };
  for (const [response, expected] of [
    [JSON.stringify(healthy), []],
    [JSON.stringify({ ...healthy, status: 'degraded', database: 'unavailable', private: 'PRIVATE_DO_NOT_LOG' }), ['application', 'database']],
    [JSON.stringify({ ...healthy, merchandiseExpiry: { enabled: false } }), ['expiry-worker']],
    ['PRIVATE_INVALID_JSON', ['json']],
  ]) {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'stor24-health-'));
    const fixture = join(fixtureRoot, 'health.json');
    writeFileSync(fixture, response, { flag: 'wx', mode: 0o600 });
    const result = spawnSync(process.execPath, ['-e', script, fixture], { env: { ...process.env, EXPECT_MERCHANDISE_WORKER: 'true' }, encoding: 'utf8' });
    rmSync(fixtureRoot, { recursive: true });
    assert.equal(result.status, expected.length ? 1 : 0);
    for (const check of expected) assert.match(result.stderr, new RegExp(`STOR24_PUBLIC_FAILED check=${check}`));
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/);
  }
});
