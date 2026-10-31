import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, chownSync, symlinkSync, unlinkSync, rmSync, statSync, openSync, fstatSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectSecuritySnapshot, checkHostSecurity, initializeSecurityBaseline } from '../scripts/check-host-security.mjs';
import { collectHostHeartbeat, publishHostHeartbeat } from '../scripts/host-heartbeat.mjs';
import { safeHeartbeat, safeSecurityFindings, monitorRequest, HEARTBEAT_URL } from '../scripts/host-heartbeat-policy.mjs';
import { checkHostHeartbeat } from '../scripts/check-host-heartbeat.mjs';
import { backupEvidence, alertDetails } from '../scripts/production-alert-details.mjs';
import worker from '../scripts/external-monitor-worker.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'stor24-security-'));
  t.after(() => { assert.ok(root.startsWith(join(tmpdir(), 'stor24-security-'))); rmSync(root, { recursive: true, force: true }); });
  function put(path, content = '') { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); return target; }
  put('etc/passwd', 'root:x:0:0:root:/root:/bin/bash\nbrett:x:1000:1000:Brett:/home/brett:/bin/bash\nsync:x:4:65534:sync:/bin:/bin/sync\n');
  put('etc/group', 'root:x:0:\nsudo:x:27:brett\n'); put('etc/shadow', 'PRIVATE_PASSWORD_DATA'); put('etc/gshadow', 'PRIVATE_GROUP_DATA');
  put('root/.ssh/authorized_keys', 'ssh-ed25519 PRIVATE_PUBLIC_KEY_LABEL\n');
  put('root/.ssh/id_ed25519', 'PRIVATE_PERSONAL_KEY');
  put('etc/ssh/stor24-keys/web', 'ssh-ed25519 FORCED_WEB_KEY\n');
  put('etc/ssh/stor24-cms-keys/cms', 'ssh-ed25519 FORCED_CMS_KEY\n');
  put('etc/ssh/ssh_host_ed25519_key.pub', 'ssh-ed25519 SERVER_PUBLIC_KEY\n');
  put('etc/ssh/ssh_host_ed25519_key', 'PRIVATE_SERVER_KEY');
  put('etc/ssh/sshd_config', 'PasswordAuthentication no\n'); put('etc/sudoers', 'root ALL=(ALL:ALL) ALL\n');
  put('etc/ufw/user.rules', '*filter\n'); mkdirSync(join(root, 'var/lib'), { recursive: true });
  return { root, put };
}
const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0;

test('snapshot contains fingerprints and metadata, never account/key/password contents', t => {
  const f = fixture(t); const snapshot = collectSecuritySnapshot(f.root);
  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /PRIVATE_PASSWORD_DATA|PRIVATE_GROUP_DATA|PRIVATE_PUBLIC_KEY_LABEL|FORCED_WEB_KEY|PRIVATE_SERVER_KEY|PRIVATE_PERSONAL_KEY/);
  assert.match(snapshot.groups.sshKeys['/root/.ssh/authorized_keys'].sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.groups.sshKeys['/etc/ssh/stor24-keys/web'].type, 'file');
  assert.equal(snapshot.groups.sshKeys['/home/brett/.ssh/authorized_keys'].type, 'missing');
});

test('missing baseline is unavailable and a read check never creates it', t => {
  const f = fixture(t); assert.deepEqual(checkHostSecurity(f.root), { security: 'unknown', markers: ['STOR24_SECURITY_CHECK_UNAVAILABLE'] });
  assert.throws(() => readFileSync(join(f.root, 'var/lib/stor24-security/baseline.json')), /ENOENT/);
});

test('trusted baseline is exclusive/root-only and unchanged files pass', { skip: !linuxRoot }, t => {
  const f = fixture(t); initializeSecurityBaseline(f.root);
  assert.equal(statSync(join(f.root, 'var/lib/stor24-security')).mode & 0o777, 0o700);
  const path = join(f.root, 'var/lib/stor24-security/baseline.json');
  const fd = openSync(path, 'r');
  try { assert.equal(fstatSync(fd).mode & 0o777, 0o600); } finally { closeSync(fd); }
  assert.deepEqual(checkHostSecurity(f.root), { security: 'success', markers: [] });
  const before = readFileSync(path); assert.throws(() => initializeSecurityBaseline(f.root), /EEXIST/); assert.deepEqual(readFileSync(path), before);
});

test('account creation/group changes, default/custom keys and security settings each produce their own finding', { skip: !linuxRoot }, async t => {
  for (const [path, text, marker] of [
    ['etc/passwd', 'root:x:0:0:root:/root:/bin/bash\nnew-admin:x:0:0:other:/home/new:/bin/bash\n', 'STOR24_ACCOUNTS_CHANGED'],
    ['etc/group', 'sudo:x:27:brett,unexpected\n', 'STOR24_ACCOUNTS_CHANGED'],
    ['home/brett/.ssh/authorized_keys', 'ssh-ed25519 ADDED_KEY\n', 'STOR24_SSH_KEYS_CHANGED'],
    ['etc/ssh/stor24-cms-keys/cms', 'ssh-ed25519 REPLACED_KEY\n', 'STOR24_SSH_KEYS_CHANGED'],
    ['etc/ssh/ssh_host_ed25519_key.pub', 'ssh-ed25519 REPLACED_HOST_KEY\n', 'STOR24_SSH_KEYS_CHANGED'],
    ['etc/ssh/sshd_config.d/99-extra.conf', 'PasswordAuthentication yes\n', 'STOR24_SECURITY_SETTINGS_CHANGED'],
    ['etc/sudoers.d/extra', 'unexpected ALL=(ALL) NOPASSWD:ALL\n', 'STOR24_SECURITY_SETTINGS_CHANGED'],
    ['etc/ufw/user.rules', 'changed firewall\n', 'STOR24_SECURITY_SETTINGS_CHANGED'],
  ]) await t.test(path, child => {
    const f = fixture(child); initializeSecurityBaseline(f.root); const before = readFileSync(join(f.root, 'var/lib/stor24-security/baseline.json'));
    f.put(path, text); const result = checkHostSecurity(f.root);
    assert.equal(result.security, 'failure'); assert.ok(result.markers.includes(marker));
    assert.deepEqual(readFileSync(join(f.root, 'var/lib/stor24-security/baseline.json')), before);
  });
});

test('deletion and permissions are detected; recreated identical content clears the finding without changing baseline', { skip: !linuxRoot }, t => {
  const f = fixture(t); const path = join(f.root, 'root/.ssh/authorized_keys'); chmodSync(path, 0o600); initializeSecurityBaseline(f.root);
  chmodSync(path, 0o644); assert.ok(checkHostSecurity(f.root).markers.includes('STOR24_SSH_KEYS_CHANGED'));
  chmodSync(path, 0o600); assert.equal(checkHostSecurity(f.root).security, 'success');
  unlinkSync(path); assert.ok(checkHostSecurity(f.root).markers.includes('STOR24_SSH_KEYS_CHANGED'));
  writeFileSync(path, 'ssh-ed25519 PRIVATE_PUBLIC_KEY_LABEL\n', { mode: 0o600 }); assert.equal(checkHostSecurity(f.root).security, 'success');
});

test('corrupt, permissive, missing and symlinked baselines fail closed', { skip: !linuxRoot }, t => {
  const f = fixture(t); initializeSecurityBaseline(f.root); const path = join(f.root, 'var/lib/stor24-security/baseline.json'); const saved = readFileSync(path);
  chmodSync(path, 0o644); assert.equal(checkHostSecurity(f.root).security, 'unknown'); chmodSync(path, 0o600);
  writeFileSync(path, 'invalid JSON'); assert.equal(checkHostSecurity(f.root).security, 'unknown'); writeFileSync(path, saved);
  unlinkSync(path); symlinkSync(f.put('elsewhere.json', saved), path); assert.equal(checkHostSecurity(f.root).security, 'unknown');
});

test('SSH directory permission changes are detected without reading personal private keys', { skip: !linuxRoot }, t => {
  const f = fixture(t); const directory = join(f.root, 'root/.ssh'); chmodSync(directory, 0o700); initializeSecurityBaseline(f.root);
  chmodSync(directory, 0o777); assert.ok(checkHostSecurity(f.root).markers.includes('STOR24_SSH_KEYS_CHANGED'));
  chmodSync(directory, 0o700); f.put('root/.ssh/id_ed25519', 'REPLACED_PRIVATE_KEY');
  assert.equal(checkHostSecurity(f.root).security, 'success');
});

test('symlinked inventory entries cannot conceal changes or escape the inventory', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const link = f.put('etc/ssh/stor24-keys/link'); unlinkSync(link); symlinkSync(f.put('outside', 'SHOULD_NOT_READ'), link);
  assert.throws(() => collectSecuritySnapshot(f.root), /UNSUPPORTED/);
});

test('malformed accounts and oversized inventories are unavailable', t => {
  const f = fixture(t); f.put('etc/passwd', 'malformed'); assert.throws(() => collectSecuritySnapshot(f.root), /ACCOUNT_FORMAT/);
  f.put('etc/passwd', 'root:x:0:0:root:/root:/bin/bash\n'); f.put('root/.ssh/authorized_keys', Buffer.alloc(1024 * 1024 + 1));
  assert.throws(() => collectSecuritySnapshot(f.root), /UNSUPPORTED/);
});

test('inventory entry/depth limits bound attacker-controlled key directories', t => {
  const f = fixture(t);
  for (let index = 0; index < 1025; index++) f.put(`etc/ssh/stor24-keys/entry-${index}`, 'x');
  assert.throws(() => collectSecuritySnapshot(f.root), /INVENTORY_TOO_LARGE/);
  const keys = join(f.root, 'etc/ssh/stor24-keys'); assert.ok(keys.startsWith(f.root)); rmSync(keys, { recursive: true });
  f.put('etc/ssh/stor24-keys/a/b/c/d/e/f/g/h', 'x');
  assert.throws(() => collectSecuritySnapshot(f.root), /INVENTORY_TOO_LARGE/);
});

test('baseline ownership and writable parent changes are unavailable', { skip: !linuxRoot }, t => {
  const f = fixture(t); initializeSecurityBaseline(f.root); const path = join(f.root, 'var/lib/stor24-security/baseline.json');
  chownSync(path, 1000, 1000); assert.equal(checkHostSecurity(f.root).security, 'unknown'); chownSync(path, 0, 0);
  chmodSync(join(f.root, 'var/lib/stor24-security'), 0o755); assert.equal(checkHostSecurity(f.root).security, 'unknown');
  chmodSync(join(f.root, 'var/lib/stor24-security'), 0o700); chmodSync(join(f.root, 'var/lib'), 0o777); assert.equal(checkHostSecurity(f.root).security, 'unknown');
});

test('versioned symlink invokes the actual checker and rejects unknown commands without writing a baseline', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const link = join(f.root, 'checker.mjs'); symlinkSync(fileURLToPath(new URL('../scripts/check-host-security.mjs', import.meta.url)), link);
  const result = spawnSync(process.execPath, [link, '--not-a-command'], { env: { PATH: '' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 2); assert.match(result.stderr, /STOR24_SECURITY_CHECK_UNAVAILABLE/);
  assert.throws(() => readFileSync(join(f.root, 'var/lib/stor24-security/baseline.json')), /ENOENT/);
});

test('security report consistency cannot claim success while carrying a change or unknown marker', () => {
  const base = { version: 1, checkedAt: new Date().toISOString(), backup: 'success', resources: 'success', markers: [] };
  assert.ok(safeHeartbeat(base));
  for (const report of [{ ...base, security: 'success', markers: ['STOR24_ACCOUNTS_CHANGED'] }, { ...base, security: 'failure' }, { ...base, markers: ['STOR24_SECURITY_CHECK_UNAVAILABLE'] }, { ...base, security: 'unknown' }]) assert.equal(safeHeartbeat(report), null);
  assert.ok(safeHeartbeat({ ...base, security: 'failure', markers: ['STOR24_ACCOUNTS_CHANGED'] }));
});

test('actual collector -> authenticated Worker -> external check -> alert preserves changes without leaking data', async t => {
  t.mock.method(console, 'info', () => {});
  const data = new Map(); const key = 'a'.repeat(64);
  const env = { STOR24_HEARTBEAT_KEY: key, STOR24_SECURITY_CHANGES_ENABLED: 'true', STOR24_SECURITY_CHANGES_REQUIRED: 'true', MONITOR_EVIDENCE: { get: async name => data.has(name) ? JSON.parse(data.get(name)) : null, put: async (name, value) => data.set(name, value) } };
  const fetcher = (url, options) => worker.fetch(new Request(url, options), env);
  const run = () => ({ status: 0, stdout: '' });
  await publishHostHeartbeat(env, { run, fetcher, securityCheck: () => ({ security: 'failure', markers: ['STOR24_SSH_KEYS_CHANGED'] }) });
  const result = await checkHostHeartbeat(env, fetcher); assert.equal(result.ok, false); assert.deepEqual(result.markers, ['STOR24_SSH_KEYS_CHANGED']);
  const alert = alertDetails({ READINESS_RESULT: 'success', BACKUP_RESULT: 'failure', BACKUP_LOG: result.markers.join('\n') }, 'FAILURE');
  assert.equal(alert.severity, 'HIGH'); assert.match(alert.text, /authorised SSH keys/); assert.match(alert.text, /not proof of an intrusion/);
  assert.doesNotMatch(JSON.stringify([...data.values()]), /PRIVATE_PASSWORD|PRIVATE_PUBLIC_KEY|root@/);
  assert.equal((await worker.fetch(new Request(`${HEARTBEAT_URL}/host`), env)).status, 401);
  const old = collectHostHeartbeat(run); old.checkedAt = new Date(Date.now() + 1).toISOString();
  await monitorRequest(env, 'host', { method: 'POST', body: old, fetcher });
  assert.deepEqual(await checkHostHeartbeat(env, fetcher), { ok: false, markers: ['STOR24_SSH_KEYS_CHANGED', 'STOR24_SECURITY_CHECK_UNAVAILABLE'] });
  assert.equal((await checkHostHeartbeat({ ...env, STOR24_SECURITY_CHANGES_REQUIRED: 'false' }, fetcher)).ok, false);
  data.delete('security-findings'); // Simulates separate, trusted provider-owner acknowledgement.
  assert.equal((await checkHostHeartbeat({ ...env, STOR24_SECURITY_CHANGES_REQUIRED: 'false' }, fetcher)).ok, true);
});

test('actual file change stays visible outside the host after restoration, and host credentials cannot clear it', { skip: !linuxRoot }, async t => {
  t.mock.method(console, 'info', () => {}); const f = fixture(t); initializeSecurityBaseline(f.root);
  f.put('root/.ssh/authorized_keys', 'ssh-ed25519 ADDED_UNTRUSTED_KEY\n');
  const data = new Map(); const key = 'a'.repeat(64);
  const env = { STOR24_HEARTBEAT_KEY: key, STOR24_SECURITY_CHANGES_ENABLED: 'true', STOR24_SECURITY_CHANGES_REQUIRED: 'true', MONITOR_EVIDENCE: { get: async name => data.has(name) ? JSON.parse(data.get(name)) : null, put: async (name, value) => data.set(name, value) } };
  const fetcher = (url, options) => worker.fetch(new Request(url, options), env);
  const dependencies = { run: () => ({ status: 0, stdout: '' }), fetcher, securityCheck: () => checkHostSecurity(f.root) };
  await publishHostHeartbeat(env, dependencies); const retained = data.get('security-findings'); assert.ok(retained);
  f.put('root/.ssh/authorized_keys', 'ssh-ed25519 PRIVATE_PUBLIC_KEY_LABEL\n');
  assert.equal(checkHostSecurity(f.root).security, 'success');
  await new Promise(resolve => setTimeout(resolve, 5));
  await publishHostHeartbeat(env, dependencies);
  assert.equal(JSON.parse(data.get('host')).report.security, 'success');
  assert.deepEqual(await checkHostHeartbeat(env, fetcher), { ok: false, markers: ['STOR24_SSH_KEYS_CHANGED'] });
  assert.equal(data.get('security-findings'), retained);
  assert.equal((await fetcher(`${HEARTBEAT_URL}/host`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } })).status, 405);
  assert.doesNotMatch(JSON.stringify([...data.values()]), /ADDED_UNTRUSTED_KEY|PRIVATE_PUBLIC_KEY_LABEL/);
});

test('malformed retained findings and misspelled enablement never produce a healthy result', async () => {
  assert.equal(safeSecurityFindings({ markers: ['RAW_SECRET'], firstSeenAt: new Date().toISOString() }), null);
  const env = { STOR24_HEARTBEAT_KEY: 'a'.repeat(64), STOR24_SECURITY_CHANGES_REQUIRED: 'TRUE' };
  assert.deepEqual(await checkHostHeartbeat(env, () => assert.fail('no read')), { ok: false, markers: ['STOR24_SECURITY_CHECK_UNAVAILABLE'] });
  await assert.rejects(publishHostHeartbeat({ STOR24_SECURITY_CHANGES_ENABLED: 'TRUE' }, { fetcher: () => assert.fail('no upload') }), /CONFIGURATION/);
});

test('security findings never hide or downgrade simultaneous backup/resource failures, and echoed source is not a finding', () => {
  const evidence = backupEvidence('STOR24_SECURITY_CHECK_UNAVAILABLE\nSTOR24_BACKUP_FAILED\nSTOR24_RESOURCES_FAILED');
  assert.equal(evidence.severity, 'HIGH'); assert.match(evidence.failure, /backup and server resource/); assert.match(evidence.failure, /Security change detection unavailable/);
  assert.equal(backupEvidence('echo STOR24_SSH_KEYS_CHANGED'), null);
  assert.equal(backupEvidence('STOR24_ACCOUNTS_CHANGED\nSTOR24_BACKUP_FAILED').severity, 'HIGH');
});
