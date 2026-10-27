import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { SequentialPrismaPg } from "../src/lib/sequential-prisma-pg";

test("Prisma transaction queries serialize, retain results and release after the final query", async t => {
  const calls: string[] = [];
  let active = 0;
  const transaction = {
    async queryRaw() {
      assert.equal(active++, 0, "a connection cannot execute overlapping queries");
      calls.push("read");
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return { columnNames: [], columnTypes: [], rows: [] };
    },
    async executeRaw() {
      assert.equal(active++, 0);
      calls.push("write");
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return 1;
    },
    async commit() { assert.equal(active, 0); calls.push("commit"); },
    async rollback() { assert.equal(active, 0); calls.push("rollback"); },
  };
  t.mock.method(PrismaPg.prototype, "connect", async () => ({ startTransaction: async () => transaction }));
  const adapter = await new SequentialPrismaPg("postgresql://synthetic.invalid/db").connect();
  const tx = await adapter.startTransaction();
  const query = { sql: "SELECT 1", args: [], argTypes: [] };
  const result = await Promise.all([tx.queryRaw(query), tx.executeRaw(query), tx.queryRaw(query), tx.commit()]);
  assert.equal(result[1], 1);
  assert.deepEqual(calls, ["read", "write", "read", "commit"]);
});

test("failed queries retain their rejection and still allow rollback", async t => {
  const failure = new Error("synthetic query failure");
  let rolledBack = false;
  const transaction = {
    async queryRaw() { throw failure; },
    async executeRaw() { throw failure; },
    async commit() { assert.fail("a failed transaction must roll back"); },
    async rollback() { rolledBack = true; },
  };
  t.mock.method(PrismaPg.prototype, "connect", async () => ({ startTransaction: async () => transaction }));
  const adapter = await new SequentialPrismaPg("postgresql://synthetic.invalid/db").connect();
  const tx = await adapter.startTransaction();
  await assert.rejects(tx.queryRaw({ sql: "SELECT 1", args: [], argTypes: [] }), error => error === failure);
  await tx.rollback();
  assert.equal(rolledBack, true);
});

test("independent transactions retain independent connection concurrency", async t => {
  let active = 0;
  let peak = 0;
  t.mock.method(PrismaPg.prototype, "connect", async () => ({
    startTransaction: async () => ({
      async queryRaw() {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return { columnNames: [], columnTypes: [], rows: [] };
      },
      async executeRaw() { return 1; },
      async commit() {},
      async rollback() {},
    }),
  }));
  const adapter = await new SequentialPrismaPg("postgresql://synthetic.invalid/db").connect();
  const first = await adapter.startTransaction();
  const second = await adapter.startTransaction();
  await Promise.all([first.queryRaw({ sql: "SELECT 1", args: [], argTypes: [] }), second.queryRaw({ sql: "SELECT 1", args: [], argTypes: [] })]);
  assert.equal(peak, 2);
});
