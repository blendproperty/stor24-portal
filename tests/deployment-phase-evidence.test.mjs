import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
assert.ok(existsSync(bash), 'Actual Bash is required; deployment tests must not silently skip');
const sha = 'a'.repeat(40);
const workflow = readFileSync(resolve('.github/workflows/deploy-vps.yml'), 'utf8');
const start = workflow.indexOf('"set -o pipefail && umask 077');
assert.ok(start > 0);
const remote = workflow.slice(start + 1).trim().replace(/"$/, '')
  .replace(/\\\r?\n\s*/g, ' ').replace(/\\\$/g, '$').replace(/\\"/g, '"')
  .replace('cd /opt/stor24-crm', 'cd "$FIXTURE_ROOT"').replaceAll('$DEPLOY_REF', sha);

function run(fail = '', mode = '') {
  const root = mkdtempSync(join(tmpdir(), 'stor24-deploy-diagnostic-'));
  try {
    for (const path of ['scripts', 'bin']) mkdirSync(join(root, path));
    copyFileSync(resolve('scripts/deployment-phase-evidence.sh'), join(root, 'scripts/deployment-phase-evidence.sh'));
    writeFileSync(join(root, '.env'), 'INTEGRATION_CONFIG_ENCRYPTION_KEY=fixture-only\nLEAD_SLA_WORKER_KEY=fixture-only\n');
    writeFileSync(join(root, 'scripts/dlp-backup.sh'), 'exit 0\n');
    const writeStub = (name, code) => writeFileSync(join(root, 'bin', name), '#!/usr/bin/env bash\n' + code, { mode: 0o755 });
    writeStub('git', '[[ "$1" == rev-parse ]] && echo aaaaaaaa; exit 0\n');
    for (const name of ['systemctl', 'install', 'sleep']) writeStub(name, 'exit 0\n');
    writeStub('docker', `
if [[ "$1" == inspect ]]; then
  if [[ "$3" == *'.Id'* ]]; then
    if [[ "$MODE" == slow && ! -f "$FIXTURE_ROOT/slow-once" ]]; then
      : > "$FIXTURE_ROOT/slow-once"
      exec /usr/bin/sleep 30
    fi
    [[ "$MODE" == missing ]] && exit 127
    [[ "$MODE" == malformed ]] && { printf 'PRIVATE_DO_NOT_LOG\\n'; exit 0; }
    [[ "$MODE" == oversized ]] && { printf '%0600dPRIVATE_DO_NOT_LOG' 0; exit 0; }
    printf '%064d|sha256:%064d|running|healthy|false|stor24-crm:aaaaaaaa\\n' 0 0
  else
    [[ "$FAIL" == health ]] && echo unhealthy || echo healthy
  fi
  exit 0
fi
case " $* " in
  *' build '*) echo build >> "$FIXTURE_ROOT/actions"; [[ "$FAIL" == build ]] && exit 41 ;;
  *' run '*) echo migrate >> "$FIXTURE_ROOT/actions"; [[ "$FAIL" == migrate ]] && exit 42 ;;
  *' up '*) echo cutover >> "$FIXTURE_ROOT/actions"; [[ "$FAIL" == cutover ]] && exit 43 ;;
  *' ps '*) echo container ;;
esac
exit 0
`);
    writeStub('curl', `
if [[ "$*" == *'--write-out'* ]]; then
  [[ "$MODE" == missing ]] && exit 127
  [[ "$MODE" == malformed ]] && { printf 'PRIVATE_DO_NOT_LOG'; exit 0; }
  printf 200; exit 0
fi
echo final-health >> "$FIXTURE_ROOT/actions"
[[ "$FAIL" == final-health ]] && exit 47
exit 0
`);
    const result = spawnSync(bash, ['-c', 'cd "$FIXTURE_ROOT"; export PATH="$PWD/bin:$PATH"; ' + remote], {
      env: { ...process.env, FIXTURE_ROOT: root.replaceAll('\\', '/'), FAIL: fail, MODE: mode },
      encoding: 'utf8', timeout: 20000, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    assert.ok(!result.stdout.includes('PRIVATE_DO_NOT_LOG'));
    assert.ok(!result.stderr.includes('PRIVATE_DO_NOT_LOG'));
    const records = result.stdout.split(/\r?\n/).filter(x => x.startsWith('STOR24_DEPLOY_PHASE '))
      .map(x => JSON.parse(x.slice('STOR24_DEPLOY_PHASE '.length)));
    assert.ok(records.length > 0, result.stderr);
    for (const item of records) {
      assert.equal(item.sha, sha);
      assert.match(item.utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.ok(JSON.stringify(item).length < 650);
    }
    return { status: result.status, records, actions: existsSync(join(root, 'actions')) ? readFileSync(join(root, 'actions'), 'utf8').trim().split(/\r?\n/) : [] };
  } finally {
    // Verify the resolved, uniquely created target before recursive fixture cleanup.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'stor24-deploy-diagnostic-')));
    rmSync(root, { recursive: true, force: true });
  }
}

test('actual remote workflow preserves successful command order and exact image snapshots', () => {
  const r = run();
  assert.equal(r.status, 0);
  assert.deepEqual(r.actions, ['build', 'migrate', 'cutover', 'final-health']);
  assert.deepEqual(r.records.map(x => x.phase), ['setup', 'pre-build', 'post-build', 'pre-migrate', 'post-migrate', 'pre-cutover', 'post-cutover', 'healthy', 'final']);
  assert.equal(r.records.at(-1).exitStatus, 0);
  assert.equal(r.records.at(-1).health, 'healthy');
  assert.equal(r.records.at(-1).localHttp, '200');
});

for (const [failure, status, phase, actions] of [
  ['build', 41, 'pre-build', ['build']],
  ['migrate', 42, 'pre-migrate', ['build', 'migrate']],
  ['cutover', 43, 'pre-cutover', ['build', 'migrate', 'cutover']],
  ['health', 1, 'post-cutover', ['build', 'migrate', 'cutover']],
  ['final-health', 47, 'healthy', ['build', 'migrate', 'cutover', 'final-health']],
]) test(`actual workflow retains ${failure} failure exit and never runs later work`, () => {
  const r = run(failure);
  assert.equal(r.status, status);
  assert.deepEqual(r.actions, actions);
  assert.equal(r.records.at(-1).phase, 'final');
  assert.equal(r.records.at(-1).lastPhase, phase);
  assert.equal(r.records.at(-1).exitStatus, status);
});

for (const mode of ['missing', 'malformed', 'oversized']) test(`diagnostic ${mode} output is bounded and cannot change deployment result`, () => {
  for (const fail of ['', 'migrate']) {
    const r = run(fail, mode);
    assert.equal(r.status, fail ? 42 : 0);
    assert.equal(r.records.at(-1).exitStatus, fail ? 42 : 0);
    assert.equal(r.records.at(-1).container, 'unknown');
    assert.equal(r.records.at(-1).image, 'unknown');
  }
});

test('a real diagnostic process timeout is bounded and does not fail a successful deployment', () => {
  const started = Date.now();
  const r = run('', 'slow');
  assert.equal(r.status, 0);
  assert.equal(r.records[0].container, 'unknown');
  assert.equal(r.records.at(-1).health, 'healthy');
  assert.ok(Date.now() - started < 15000, 'One diagnostic timeout must not consume the deployment window');
});
