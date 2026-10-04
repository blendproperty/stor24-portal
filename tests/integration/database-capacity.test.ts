import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "../../src/lib/db";
import { databaseLimits } from "../../src/lib/database-limits";

test("isolated database queues bounded concurrent reads without errors", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const phases = [];
  try {
    for (const concurrent of [10, 25, 50]) {
      const timings: number[] = [];
      const started = performance.now();
      await Promise.all(Array.from({ length: concurrent }, async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const before = performance.now();
          // Read-only queue-pressure probe; no business records or provider calls.
          await db.$queryRaw`SELECT 1 FROM pg_sleep(0.01)`;
          timings.push(performance.now() - before);
        }
      }));
      timings.sort((a, b) => a - b);
      const pool = await db.$queryRaw<{ connections: number }[]>`SELECT count(*)::int AS connections FROM pg_stat_activity WHERE application_name = 'stor24-crm'`;
      assert.ok(pool[0].connections <= databaseLimits().max);
      const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
      assert.ok(p95Ms < 5000, `CI database read queue exceeded 5 seconds at ${concurrent}`);
      phases.push({ concurrent, requests: timings.length, errors: 0, p95Ms, elapsedMs: performance.now() - started, connections: pool[0].connections });
    }
    mkdirSync("output/readiness", { recursive: true });
    writeFileSync("output/readiness/database-capacity.json", JSON.stringify({ verifiedAt: new Date().toISOString(), environment: "isolated-ci", scope: "database read queue probe; not full application or production peak capacity", phases }, null, 2));
  } finally { await db.$disconnect(); }
});
