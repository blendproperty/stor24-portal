import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function migrationEnvironment(env) {
  const migration = env.MIGRATION_DATABASE_URL;
  const runtime = env.DATABASE_URL;
  if (!migration || !runtime) throw new Error('Both runtime and migration database URLs are required');
  let source, target;
  try { source = new URL(runtime); target = new URL(migration); } catch { throw new Error('Invalid database URL'); }
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('PostgreSQL URLs are required');
  for (const url of [source, target]) {
    if (!url.hostname || !url.pathname || url.pathname === '/' || [...url.searchParams.keys()].some(key => ['host', 'hostaddr', 'port', 'dbname', 'database', 'service', 'options'].includes(key.toLowerCase()))) throw new Error('Database target must be explicit in the URL');
  }
  if (source.hostname !== target.hostname || (source.port || '5432') !== (target.port || '5432') || source.pathname !== target.pathname) throw new Error('Runtime and migration URLs must target the same database');
  if (!source.username || !target.username || decodeURIComponent(source.username) === decodeURIComponent(target.username)) throw new Error('Runtime and migration roles must be distinct');
  const child = { ...env, DATABASE_URL: migration };
  delete child.MIGRATION_DATABASE_URL;
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let env;
  try { env = migrationEnvironment(process.env); } catch (error) { console.error(error.message); process.exit(1); }
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...['migrate', 'deploy']], { env, stdio: 'inherit' });
  if (result.error) { console.error('Could not start migration process'); process.exit(1); }
  process.exit(result.status ?? 1);
}
