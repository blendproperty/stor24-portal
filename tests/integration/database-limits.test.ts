import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { databaseConfig } from "../../src/lib/database-limits";

test("isolated PostgreSQL enforces query deadlines and recovers the connection", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("statement_timeout", "0");
  const adapter = new PrismaPg(databaseConfig(url.toString(), { DB_STATEMENT_TIMEOUT_MS: "100", DB_POOL_MAX: "2" }));
  const client = new PrismaClient({ adapter });
  try {
    const rows = await client.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    assert.equal(rows[0].statement_timeout, "100ms");
    const idle = await client.$queryRaw<{ idle_in_transaction_session_timeout: string }[]>`SHOW idle_in_transaction_session_timeout`;
    assert.equal(idle[0].idle_in_transaction_session_timeout, "1min");
    await assert.rejects(client.$queryRaw`SELECT pg_sleep(0.5)`, /statement timeout/);
    const recovered = await client.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
    assert.equal(recovered[0].ok, 1);
  } finally { await client.$disconnect(); }
});
