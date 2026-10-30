import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, readdirSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;
const STATE_DIR = '/var/lib/stor24-security';
const BASELINE = `${STATE_DIR}/baseline.json`;
const accountFiles = ['/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow'];
const keyDirectories = ['/etc/ssh/stor24-keys', '/etc/ssh/stor24-cms-keys'];
const hostPublicKeys = ['/etc/ssh/ssh_host_ed25519_key.pub', '/etc/ssh/ssh_host_ecdsa_key.pub', '/etc/ssh/ssh_host_rsa_key.pub'];
const settingPaths = ['/etc/ssh/sshd_config', '/etc/ssh/sshd_config.d', '/etc/sudoers', '/etc/sudoers.d', '/etc/ufw', '/etc/pam.d', '/etc/security', '/etc/docker/daemon.json', '/usr/local/sbin/stor24-web-release', '/usr/local/sbin/stor24-cms-release', '/usr/local/lib/stor24-web-release', '/usr/local/lib/stor24-cms-release'];
export const SECURITY_CHANGE_MARKERS = ['STOR24_ACCOUNTS_CHANGED', 'STOR24_SSH_KEYS_CHANGED', 'STOR24_SECURITY_SETTINGS_CHANGED'];

function diskPath(root, name) {
  const base = resolve(root); const target = resolve(base, `.${name}`); const rel = relative(base, target);
  if (!name.startsWith('/') || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('SECURITY_PATH_INVALID');
  let cursor = base;
  for (const part of rel.split(sep).slice(0, -1)) {
    cursor = resolve(cursor, part);
    try { if (!lstatSync(cursor).isDirectory()) throw Error('SECURITY_PATH_UNSUPPORTED'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  return target;
}

function readBounded(file) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > MAX_FILE_BYTES) throw Error('SECURITY_FILE_UNSUPPORTED');
    const data = Buffer.alloc(Math.min(MAX_FILE_BYTES + 1, before.size + 1)); let size = 0;
    while (size < data.length) { const bytes = readSync(fd, data, size, data.length - size, null); if (!bytes) break; size += bytes; }
    const after = fstatSync(fd); const current = lstatSync(file);
    if (size > MAX_FILE_BYTES || before.size !== size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ctimeMs !== current.ctimeMs || before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) throw Error('SECURITY_FILE_CHANGED_DURING_READ');
    return { data: data.subarray(0, size), stat: before };
  } finally { closeSync(fd); }
}

export function collectSecuritySnapshot(root = '/') {
  const groups = { accounts: Object.create(null), sshKeys: Object.create(null), settings: Object.create(null) }; let entries = 0;
  function record(name, group, depth = 0, recurse = true) {
    if (++entries > MAX_ENTRIES || depth > 6) throw Error('SECURITY_INVENTORY_TOO_LARGE');
    const file = diskPath(root, name); let stat;
    try { stat = lstatSync(file); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; group[name] = { type: 'missing' }; return; }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error('SECURITY_FILE_UNSUPPORTED');
    group[name] = { type: stat.isDirectory() ? 'directory' : 'file', uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777 };
    if (stat.isDirectory() && recurse) {
      const names = readdirSync(file).sort(); if (names.length > MAX_ENTRIES) throw Error('SECURITY_INVENTORY_TOO_LARGE');
      for (const child of names) record(`${name}/${child}`, group, depth + 1);
    } else if (stat.isFile()) {
      const read = readBounded(file);
      group[name] = { type: 'file', uid: read.stat.uid, gid: read.stat.gid, mode: read.stat.mode & 0o7777, sha256: createHash('sha256').update(read.data).digest('hex') };
    }
  }
  for (const name of accountFiles) record(name, groups.accounts);
  const passwd = readBounded(diskPath(root, '/etc/passwd')).data.toString('utf8');
  const homes = new Set(['/root']);
  for (const line of passwd.split(/\r?\n/).filter(Boolean)) {
    const fields = line.split(':');
    if (fields.length !== 7 || !/^\d+$/.test(fields[2]) || !fields[5].startsWith('/') || fields[5].includes('..')) throw Error('SECURITY_ACCOUNT_FORMAT_INVALID');
    if (Number(fields[2]) === 0 || Number(fields[2]) >= 1000 || !/\/(?:nologin|false|sync)$/.test(fields[6])) homes.add(fields[5].replace(/\/+$/, '') || '/');
  }
  for (const home of [...homes].sort()) {
    const prefix = home === '/' ? '' : home;
    record(`${prefix}/.ssh`, groups.sshKeys, 0, false);
    for (const suffix of ['authorized_keys', 'authorized_keys2']) record(`${prefix}/.ssh/${suffix}`, groups.sshKeys);
  }
  for (const name of keyDirectories) record(name, groups.sshKeys);
  for (const name of hostPublicKeys) record(name, groups.sshKeys);
  for (const name of settingPaths) record(name, groups.settings);
  return { version: 1, groups };
}

function trustedBaseline(root) {
  for (const name of ['/var', '/var/lib', STATE_DIR]) {
    const stat = lstatSync(diskPath(root, name));
    if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022) || (name === STATE_DIR && (stat.mode & 0o777) !== 0o700)) throw Error('SECURITY_BASELINE_PERMISSIONS');
  }
  const file = diskPath(root, BASELINE); const stat = lstatSync(file);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600) throw Error('SECURITY_BASELINE_PERMISSIONS');
  const parsed = JSON.parse(readBounded(file).data.toString('utf8'));
  if (parsed.version !== 1 || !Number.isFinite(Date.parse(parsed.createdAt)) || !parsed.groups || Object.keys(parsed.groups).sort().join(',') !== 'accounts,settings,sshKeys') throw Error('SECURITY_BASELINE_INVALID');
  for (const group of Object.values(parsed.groups)) if (!group || typeof group !== 'object' || Array.isArray(group) || !Object.keys(group).length) throw Error('SECURITY_BASELINE_INVALID');
  return parsed;
}

export function checkHostSecurity(root = '/') {
  try {
    const baseline = trustedBaseline(root); const current = collectSecuritySnapshot(root); const markers = [];
    for (const [index, group] of ['accounts', 'sshKeys', 'settings'].entries()) {
      if (JSON.stringify(current.groups[group]) !== JSON.stringify(baseline.groups[group])) markers.push(SECURITY_CHANGE_MARKERS[index]);
    }
    return { security: markers.length ? 'failure' : 'success', markers };
  } catch { return { security: 'unknown', markers: ['STOR24_SECURITY_CHECK_UNAVAILABLE'] }; }
}

export function initializeSecurityBaseline(root = '/') {
  if (process.getuid?.() !== 0) throw Error('SECURITY_BASELINE_ROOT_REQUIRED');
  const snapshot = collectSecuritySnapshot(root); const parent = diskPath(root, '/var/lib');
  const stat = lstatSync(parent); if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022)) throw Error('SECURITY_BASELINE_PERMISSIONS');
  const directory = diskPath(root, STATE_DIR);
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const owner = lstatSync(directory); if (!owner.isDirectory() || owner.uid !== 0 || (owner.mode & 0o777) !== 0o700) throw Error('SECURITY_BASELINE_PERMISSIONS');
  const encoded = JSON.stringify({ ...snapshot, createdAt: new Date().toISOString() });
  if (Buffer.byteLength(encoded) > MAX_FILE_BYTES) throw Error('SECURITY_BASELINE_TOO_LARGE');
  writeFileSync(diskPath(root, BASELINE), encoded, { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0) throw Error('SECURITY_CHECK_ROOT_REQUIRED');
    if (process.argv.length === 3 && process.argv[2] === '--initialize') { initializeSecurityBaseline(); console.log('STOR24_SECURITY_BASELINE_CREATED'); }
    else if (process.argv.length === 2) { const result = checkHostSecurity(); console.log(JSON.stringify(result)); process.exitCode = result.security === 'success' ? 0 : result.security === 'failure' ? 1 : 2; }
    else throw Error('SECURITY_CHECK_ARGUMENTS_INVALID');
  } catch { console.error('STOR24_SECURITY_CHECK_UNAVAILABLE'); process.exitCode = 2; }
}
