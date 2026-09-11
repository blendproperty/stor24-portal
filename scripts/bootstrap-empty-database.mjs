import pg from "pg";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Fresh installation only. Preserve historical migration files/checksums and
// existing production history. Never run this against a populated database.
if (process.env.ALLOW_EMPTY_DATABASE_BOOTSTRAP !== "true") throw new Error("Explicit empty-database bootstrap opt-in required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
function prisma(...args) {
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  return result.status;
}
try {
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  if (tables.rowCount !== 0) throw new Error("Refusing bootstrap: public schema is not empty");
  if (prisma("migrate", "deploy") === 0) process.exitCode = 0;
  else {
    const failed = await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL');
    if (failed.rowCount !== 1 || failed.rows[0].migration_name !== "20260909160000_package_hero_artwork") throw new Error("Unexpected migration failure; no repair attempted");
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('Product','StoragePackage') AND column_name='imageUrl'");
    if (columns.rowCount !== 0) throw new Error("Unexpected image schema state; no repair attempted");
    // Apply the original prerequisite SQL, then register its original checksum
    // through Prisma itself. The failed artwork statement has made no changes.
    const sql = await readFile(new URL("../prisma/migrations/20260909170000_merchandise_images/migration.sql", import.meta.url), "utf8");
    await client.query("BEGIN");
    try { await client.query(sql); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    if (prisma("migrate", "resolve", "--applied", "20260909170000_merchandise_images") !== 0) throw new Error("Could not register prerequisite migration");
    if (prisma("migrate", "resolve", "--rolled-back", "20260909160000_package_hero_artwork") !== 0) throw new Error("Could not reset failed artwork migration");
    if (prisma("migrate", "deploy") !== 0) throw new Error("Remaining migrations failed");
  }
} finally { await client.end(); }
