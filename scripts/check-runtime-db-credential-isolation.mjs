import { pathToFileURL } from 'node:url';

// Opt-in staging/release preflight; existing production startup does not call this check.
export function assertRuntimeDatabaseCredentialIsolation(env) {
  if (!env.DATABASE_URL) throw new Error('Runtime DATABASE_URL is required');
  const forbidden = ['MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL_FILE', 'POSTGRES_PASSWORD', 'PGPASSWORD'].filter(key => Boolean(env[key]));
  if (forbidden.length) throw new Error(`Privileged or unscoped database credential variables present: ${forbidden.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { assertRuntimeDatabaseCredentialIsolation(process.env); console.log('Named privileged database credential variables are absent'); }
  catch (error) { console.error(error.message); process.exit(1); }
}
