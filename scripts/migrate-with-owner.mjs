import { spawnSync } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const secretPath = '/run/secrets/stor24_migration_url';

export function readProtectedMigrationUrl(path) {
  let fd;
  try {
    if (process.platform === 'win32' || constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined) throw new Error();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 1 || info.size > 8192 || (info.mode & 0o077) || info.uid !== process.geteuid()) throw new Error();
    const buffer = Buffer.alloc(info.size + 1);
    if (readSync(fd, buffer, 0, buffer.length, 0) !== info.size) throw new Error();
    const value = buffer.subarray(0, info.size).toString('utf8').replace(/\n$/, '');
    if (!value || /[\r\n\0\uFFFD]/.test(value)) throw new Error();
    return value;
  } catch { throw new Error('Migration secret file is unavailable or unsafe'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function migrationEnvironment(env, readSecret = readProtectedMigrationUrl) {
  if (env.PGOPTIONS) throw new Error('PGOPTIONS is not permitted for isolated migrations');
  if (env.MIGRATION_DATABASE_URL && env.MIGRATION_DATABASE_URL_FILE) throw new Error('Choose one migration credential source');
  if (env.MIGRATION_DATABASE_URL_FILE && env.MIGRATION_DATABASE_URL_FILE !== secretPath) throw new Error('Invalid migration secret path');
  const migration = env.MIGRATION_DATABASE_URL_FILE ? readSecret(secretPath) : env.MIGRATION_DATABASE_URL;
  const runtime = env.DATABASE_URL;
  if (!migration || !runtime) throw new Error('Both runtime and migration database URLs are required');
  let source, target;
  try { source = new URL(runtime); target = new URL(migration); } catch { throw new Error('Invalid database URL'); }
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('PostgreSQL URLs are required');
  for (const url of [source, target]) {
    if (!url.hostname || !url.pathname || url.pathname === '/' || [...url.searchParams.keys()].some(key => ['host', 'hostaddr', 'port', 'dbname', 'database', 'user', 'password', 'service', 'options'].includes(key.toLowerCase()))) throw new Error('Database target and credentials must be explicit in the URL');
  }
  if (source.hostname !== target.hostname || (source.port || '5432') !== (target.port || '5432') || source.pathname !== target.pathname) throw new Error('Runtime and migration URLs must target the same database');
  if (!source.username || !target.username || decodeURIComponent(source.username) === decodeURIComponent(target.username)) throw new Error('Runtime and migration roles must be distinct');
  const child = { ...env, DATABASE_URL: migration };
  delete child.MIGRATION_DATABASE_URL;
  delete child.MIGRATION_DATABASE_URL_FILE;
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let env;
  try { env = migrationEnvironment(process.env); } catch (error) { console.error(error.message); process.exit(1); }
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...['migrate', 'deploy']], { env, stdio: 'inherit' });
  if (result.error) { console.error('Could not start migration process'); process.exit(1); }
  process.exit(result.status ?? 1);
}
