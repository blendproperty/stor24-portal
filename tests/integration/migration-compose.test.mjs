import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('migration secret is mounted only into the one-off migration service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stor24-compose-'));
  try {
    for (const name of ['compose.prod.yml', 'compose.migration-isolation.yml']) copyFileSync(resolve(name), join(dir, name));
    const secret = join(dir, 'migration-secret');
    writeFileSync(secret, 'synthetic-only-migrator-secret', { mode: 0o600 });
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgresql://runtime:synthetic@localhost/db_ci\nPAYLOAD_SECRET=synthetic-only\nSENDGRID_API_KEY=synthetic-only\nEMAIL_FROM=synthetic@example.invalid\n');
    const env = { ...process.env, STOR24_MIGRATION_SECRET_FILE: secret, DATABASE_URL: 'postgresql://runtime:synthetic@localhost/db_ci', PAYLOAD_SECRET: 'synthetic-only', SENDGRID_API_KEY: 'synthetic-only', EMAIL_FROM: 'synthetic@example.invalid' };
    const config = extra => JSON.parse(execFileSync('docker', ['compose', '--project-directory', dir, '--env-file', join(dir,'.env'), '--profile', 'tools', '-f', join(dir,'compose.prod.yml'), ...extra, 'config', '--format', 'json'], { env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
    const missing = { ...env }; delete missing.STOR24_MIGRATION_SECRET_FILE;
    assert.throws(() => execFileSync('docker', ['compose', '--project-directory', dir, '--env-file', join(dir,'.env'), '-f', join(dir, 'compose.prod.yml'), '-f', join(dir, 'compose.migration-isolation.yml'), 'config', '--format', 'json'], { env: missing, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }), error => /STOR24_MIGRATION_SECRET_FILE/.test(String(error.stderr)));
    const plain = config([]);
    const isolated = config(['-f', join(dir, 'compose.migration-isolation.yml')]);
    assert.deepEqual(isolated.services['app'], plain.services['app']);
    for (const [name, service] of Object.entries(plain.services)) {
      if (name !== 'migrate') assert.deepEqual(isolated.services[name], service);
    }
    assert.equal(isolated.services['app'].environment.MIGRATION_DATABASE_URL_FILE, undefined);
    assert.equal(isolated.services['app'].environment.MIGRATION_DATABASE_URL, undefined);
    assert.equal(isolated.services['app'].secrets, undefined);
    const migration = isolated.services['migrate'];
    assert.deepEqual(migration.command, ['node','scripts/migrate-with-owner.mjs']);
    assert.equal(migration.environment.MIGRATION_DATABASE_URL_FILE, '/run/secrets/stor24_migration_url');
    assert.equal(migration.secrets.length, 1);
    assert.equal(migration.secrets[0].source, 'stor24_migration_url');
    assert.equal(migration.secrets[0].target, 'stor24_migration_url');
    assert.equal(isolated.secrets.stor24_migration_url.file, secret);
    assert.equal(JSON.stringify(isolated.services['app']).includes('synthetic-only-migrator-secret'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Linux Compose mounts the protected synthetic secret into the migration container', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'stor24-compose-mount-'));
  try {
    for (const name of ['compose.prod.yml', 'compose.migration-isolation.yml']) copyFileSync(resolve(name), join(dir, name));
    const secret = join(dir, 'migration-secret');
    writeFileSync(secret, 'synthetic-only-migrator-secret', { mode: 0o600 });
    if (process.geteuid() !== 0) execFileSync('sudo', ['-n', 'chown', '0:0', secret]);
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgresql://runtime:synthetic@localhost/db_ci\nPAYLOAD_SECRET=synthetic-only\nSENDGRID_API_KEY=synthetic-only\nEMAIL_FROM=synthetic@example.invalid\nPOSTGRES_PASSWORD=synthetic-only\n');
    const probe = 'const fs=require("fs");const p="/run/secrets/stor24_migration_url";const s=fs.statSync(p);if(fs.readFileSync(p,"utf8")!=="synthetic-only-migrator-secret"||(s.mode&63)!==0||s.uid!==process.geteuid())process.exit(1);console.log("protected synthetic file visible")';
    const override = 'services:\n  migrate:\n    image: node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53\n    network_mode: none\n    networks: !reset []\n    command: ' + JSON.stringify(['node','-e',probe]) + '\n';
    writeFileSync(join(dir, 'override.yml'), override);
    const env = { ...process.env, STOR24_MIGRATION_SECRET_FILE: secret, DATABASE_URL: 'postgresql://runtime:synthetic@localhost/db_ci', PAYLOAD_SECRET: 'synthetic-only', SENDGRID_API_KEY: 'synthetic-only', EMAIL_FROM: 'synthetic@example.invalid', POSTGRES_PASSWORD: 'synthetic-only' };
    const output = execFileSync('docker', ['compose','--project-name','st24-migration-boundary-test','--project-directory',dir,'--env-file',join(dir,'.env'),'--profile','tools','-f',join(dir,'compose.prod.yml'),'-f',join(dir,'compose.migration-isolation.yml'),'-f',join(dir,'override.yml'),'run','--rm','--no-deps','migrate'], { env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 120000 });
    assert.match(output, /protected synthetic file visible/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
