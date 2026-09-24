import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { syntheticRestoreTarget } from "../src/lib/synthetic-restore-guard";

async function main() {
  const target = syntheticRestoreTarget(process.env);
  const image = execFileSync("docker", ["inspect", "--format", "{{.Config.Image}}", target.container], { encoding: "utf8", timeout: 10_000 }).trim();
  assert.equal(image, "postgres:16", "Only the workflow's disposable PostgreSQL image is supported.");
  const command = (args: string[], input?: Buffer) => execFileSync("docker", ["exec", ...(input ? ["-i"] : []), target.container, ...args], { input, timeout: 120_000, maxBuffer: 128 * 1024 * 1024 });
  type Snapshot = { tables: Record<string, { count: number; digest: string }>; schema: unknown[]; constraints: unknown[]; indexes: unknown[]; sequences: unknown[]; enums: unknown[] };
  async function snapshot(client: Client): Promise<Snapshot> {
    await client.query("SET TIME ZONE 'UTC'");
    const tables: Snapshot["tables"] = {};
    const names = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    for (const { tablename } of names.rows) {
      const identifier = `"${tablename.replaceAll('"', '""')}"`;
      const result = await client.query<{ count: number; digest: string }>(`SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text COLLATE "C"), '')) AS digest FROM public.${identifier} t`);
      tables[tablename] = result.rows[0];
    }
    const schema = await client.query("SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name");
    const constraints = await client.query("SELECT conrelid::regclass::text AS relation, conname, contype, convalidated, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname");
    const indexes = await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname");
    const sequences = await client.query("SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename");
    const enums = await client.query("SELECT t.typname,e.enumsortorder,e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace ORDER BY t.typname,e.enumsortorder");
    return { tables, schema: schema.rows, constraints: constraints.rows, indexes: indexes.rows, sequences: sequences.rows, enums: enums.rows };
  }
  const source = new Client({ connectionString: target.sourceUrl, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  const restored = new Client({ connectionString: target.restoredUrl, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  let created = false, connected = false, backup: Buffer | undefined;
  let report: Record<string, unknown> | undefined;
  await source.connect();
  try {
    assert.equal((await source.query("SELECT 1 FROM pg_database WHERE datname=$1", [target.restoredDatabase])).rowCount, 0, "Never overwrite an existing restore target.");
    const before = await snapshot(source);
    for (const table of ["Customer", "Account", "LedgerEntry", "Document", "AuditEvent", "RoleAssignment"]) assert.ok(before.tables[table]?.count > 0, `Representative ${table} evidence is required.`);
    const started = performance.now();
    backup = command(["pg_dump", "--username=ci", `--dbname=${target.sourceDatabase}`, "--format=custom", "--no-owner", "--no-privileges"]);
    const dumpedAt = performance.now();
    command(["createdb", "--username=ci", target.restoredDatabase]); created = true;
    command(["pg_restore", "--username=ci", `--dbname=${target.restoredDatabase}`, "--no-owner", "--no-privileges", "--exit-on-error"], backup);
    const restoredAt = performance.now();
    await restored.connect(); connected = true;
    const after = await snapshot(restored);
    assert.deepEqual(after, before, "Restored rows, schema, constraints and indexes must exactly match.");
    assert.deepEqual(await snapshot(source), before, "The source database must remain unchanged.");
    report = { status: "passed", scope: "Synthetic CI PostgreSQL roundtrip only", commit: process.env.GITHUB_SHA, checkedAt: new Date().toISOString(), tableCount: Object.keys(before.tables).length, rowCounts: Object.fromEntries(Object.entries(before.tables).map(([name, value]) => [name, value.count])), schemaConstraintsIndexesMatch: true, dataChecksumsMatch: true, sourceUnchanged: true, backupBytes: backup.length, dumpMilliseconds: Math.round(dumpedAt - started), restoreMilliseconds: Math.round(restoredAt - dumpedAt), totalVerificationMilliseconds: Math.round(performance.now() - started), limitations: ["No production backup or customer data used", "No production encryption/key recovery or off-system backup acceptance", "No approved RPO/RTO measured", "No provider/device reconnection or restored-data deletion rehearsal"] };
  } finally {
    backup?.fill(0);
    if (connected) await restored.end();
    try {
      if (created) {
        command(["dropdb", "--username=ci", target.restoredDatabase]);
        assert.equal((await source.query("SELECT 1 FROM pg_database WHERE datname=$1", [target.restoredDatabase])).rowCount, 0);
      }
    } finally { await source.end(); }
  }
  await mkdir("output/recovery", { recursive: true });
  await writeFile("output/recovery/synthetic-restore.json", JSON.stringify({ ...report, disposableTargetRemoved: true }, null, 2));
  console.log(`PASS: synthetic restore matches ${report?.tableCount} tables, rows, constraints and indexes; source unchanged; disposable target removed. Production recovery acceptance remains open.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Synthetic restore failed."); process.exitCode = 1; });
