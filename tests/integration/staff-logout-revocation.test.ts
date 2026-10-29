import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { mfaLoginFixture } from "../helpers/mfa-login-fixture";
import { mfaRequest } from "../helpers/mfa-routes-fixture";

test("staff logout revocation is atomic under real PostgreSQL races and failures", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Synthetic logout CI", slug: key } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic", email: `${key}@example.invalid` } });
  const session = { userId: user.id, sessionVersion: 0, mfaVerified: true };
  try {
    await t.test("audit failure rolls back revocation and does not report signed out", async () => {
      const f = await mfaLoginFixture({ user: db.user, $transaction: <T>(operation: (client: unknown) => Promise<T>) => db.$transaction(tx => operation(new Proxy(tx, { get(target, property) {
        return property === "auditEvent" ? { create: async () => { throw new Error("SYNTHETIC_AUDIT_FAILURE"); } } : Reflect.get(target, property);
      } }))) }, session);
      assert.equal((await f.logout(mfaRequest({}))).status, 500);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 0);
      assert.equal(f.sessionClears(), 0);
    });
    await t.test("two requests with the same authorization snapshot revoke only once", async () => {
      let reads = 0, release!: () => void;
      const bothRead = new Promise<void>(resolve => { release = resolve; });
      const f = await mfaLoginFixture({ user: { findUnique: async (args: Parameters<typeof db.user.findUnique>[0]) => {
        const snapshot = await db.user.findUnique(args);
        if (++reads <= 2) { if (reads === 2) release(); await bothRead; }
        return snapshot;
      } }, $transaction: db.$transaction.bind(db) }, session);
      const responses = await Promise.all([f.logout(mfaRequest({})), f.logout(mfaRequest({}))]);
      assert.deepEqual(responses.map(response => response.status), [200, 200]);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 1);
      assert.equal(await db.auditEvent.count({ where: { actorId: user.id, action: "user.logout" } }), 1);
      assert.equal(f.sessionClears(), 2);
      assert.equal((await f.logout(mfaRequest({}))).status, 401);
    });
    await t.test("a stale logout cannot revoke a newer session generation", async () => {
      const f = await mfaLoginFixture({ user: { findUnique: async (args: Parameters<typeof db.user.findUnique>[0]) => {
        const snapshot = await db.user.findUnique(args);
        await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
        return snapshot;
      } }, $transaction: db.$transaction.bind(db) }, { ...session, sessionVersion: 1 });
      assert.equal((await f.logout(mfaRequest({}))).status, 200);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 2);
      assert.equal(await db.auditEvent.count({ where: { actorId: user.id, action: "user.logout" } }), 1);
    });
  } finally { await db.organisation.delete({ where: { id: org.id } }); await db.$disconnect(); }
});
