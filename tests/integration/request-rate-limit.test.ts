import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { rateLimit } from "../../src/lib/request-security";

test("isolated PostgreSQL shared rate limits admit bounded concurrent attempts", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const prefix = `ci-rate:${randomUUID()}:`, keys: string[] = [];
  const key = (suffix: string) => { const value = prefix + suffix; keys.push(value); return value; };
  const burst = async (value: string, limit = 5) => (await Promise.all(Array.from({ length: 40 }, () => rateLimit(value, limit, 60_000)))).filter(limited => !limited).length;
  try {
    await t.test("fresh, active and expired windows are serialized by key", async () => {
      const fresh = key("fresh");
      assert.equal(await burst(fresh), 5);
      assert.equal((await db.rateLimitBucket.findUniqueOrThrow({ where: { key: fresh } })).count, 5);
      const near = key("near"), expires = new Date(Date.now() + 60_000);
      await db.rateLimitBucket.create({ data: { key: near, count: 4, resetAt: expires } });
      assert.equal(await burst(near), 1);
      const full = await db.rateLimitBucket.findUniqueOrThrow({ where: { key: near } });
      assert.equal(full.count, 5); assert.equal(full.resetAt.getTime(), expires.getTime());
      assert.equal(await burst(near), 0);
      assert.deepEqual(await db.rateLimitBucket.findUniqueOrThrow({ where: { key: near } }), full);
      const expired = key("expired");
      await db.rateLimitBucket.create({ data: { key: expired, count: 5, resetAt: new Date(Date.now() - 1) } });
      assert.equal(await burst(expired), 5);
      const reset = await db.rateLimitBucket.findUniqueOrThrow({ where: { key: expired } });
      assert.equal(reset.count, 5); assert.ok(reset.resetAt > new Date());
    });
    await t.test("independent keys, one-attempt limits and parameterized key values", async () => {
      const first = key("first"), second = key("second"), quoted = key("quote'; DROP TABLE ignored; --");
      assert.deepEqual(await Promise.all([burst(first, 1), burst(second, 1)]), [1, 1]);
      assert.equal(await burst(quoted, 3), 3);
      assert.equal((await db.rateLimitBucket.findUniqueOrThrow({ where: { key: quoted } })).count, 3);
    });
    await t.test("sequential requests preserve polarity and allow a new expired window", async () => {
      const value = key("sequential");
      for (let i = 0; i < 5; i++) assert.equal(await rateLimit(value, 5, 60_000), false);
      assert.equal(await rateLimit(value, 5, 60_000), true);
      await db.rateLimitBucket.update({ where: { key: value }, data: { resetAt: new Date(Date.now() - 1) } });
      assert.equal(await rateLimit(value, 5, 60_000), false);
      assert.equal((await db.rateLimitBucket.findUniqueOrThrow({ where: { key: value } })).count, 1);
    });
  } finally {
    await db.rateLimitBucket.deleteMany({ where: { key: { in: keys } } });
    await db.$disconnect();
  }
});