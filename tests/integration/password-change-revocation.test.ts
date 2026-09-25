import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { db } from "../../src/lib/db";
import { hashResetToken } from "../../src/lib/password-reset";
import { mfaLoginFixture } from "../helpers/mfa-login-fixture";
import { mfaRequest } from "../helpers/mfa-routes-fixture";

test("isolated PostgreSQL password changes cannot overwrite revoked credentials", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const password = "Original-Synthetic-Password-2026!", next = "Changed-Synthetic-Password-2026!", resetPassword = "Reset-Winner-Password-2026!";
  async function fixture() {
    const key = randomUUID(), org = await db.organisation.create({ data: { name: "Password CI", slug: key } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic", email: `${key}@example.invalid`, passwordHash: await hash(password, 4) } });
    const token = randomUUID();
    const reset = await db.passwordResetToken.create({ data: { userId: user.id, organisationId: org.id, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + 60_000) } });
    const session = { userId: user.id, sessionVersion: user.sessionVersion };
    return { user, token, reset, session, routes: await mfaLoginFixture(db, session) };
  }
  try {
    await t.test("reset wins against a request paused after authenticating the old password snapshot", async () => {
      const f = await fixture();
      let captured!: () => void, release!: () => void;
      const read = new Promise<void>(r => { captured = r; }), resume = new Promise<void>(r => { release = r; });
      const stale = await mfaLoginFixture({ user: { findUnique: async (args: Parameters<typeof db.user.findUnique>[0]) => { const snapshot = await db.user.findUnique(args); captured(); await resume; return snapshot; } }, $transaction: db.$transaction.bind(db) }, f.session);
      const change = stale.changePassword(mfaRequest({ currentPassword: password, password: next }));
      await read;
      try { assert.equal((await f.routes.resetPassword(mfaRequest({ token: f.token, password: resetPassword }))).status, 200); } finally { release(); }
      assert.equal((await change).status, 401); assert.equal(stale.sessionClears(), 0);
      const current = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
      assert.equal(await compare(resetPassword, current.passwordHash!), true); assert.equal(current.sessionVersion, f.user.sessionVersion + 1);
      assert.equal(await db.auditEvent.count({ where: { actorId: f.user.id, action: "user.password.changed" } }), 0);
    });
    await t.test("two requests authenticated against the same credential admit only one change", async () => {
      const f = await fixture(); let count = 0, release!: () => void;
      const ready = new Promise<void>(r => { release = r; });
      const concurrent = await mfaLoginFixture({ user: { findUnique: async (args: Parameters<typeof db.user.findUnique>[0]) => { const snapshot = await db.user.findUnique(args); if (++count === 2) release(); await ready; return snapshot; } }, $transaction: db.$transaction.bind(db) }, f.session);
      const responses = await Promise.all([next, resetPassword].map(value => concurrent.changePassword(mfaRequest({ currentPassword: password, password: value }))));
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]); assert.equal(concurrent.sessionClears(), 1);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).sessionVersion, f.user.sessionVersion + 1);
      assert.equal(await db.auditEvent.count({ where: { actorId: f.user.id, action: "user.password.changed" } }), 1);
      assert.ok((await db.passwordResetToken.findUniqueOrThrow({ where: { id: f.reset.id } })).usedAt);
      assert.equal((await f.routes.resetPassword(mfaRequest({ token: f.token, password: resetPassword }))).status, 410);
    });
    await t.test("audit rejection rolls back password, version and reset-token invalidation; retry succeeds", async () => {
      const f = await fixture();
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_password_audit_failure CHECK (false) NOT VALID');
      try {
        await assert.rejects(f.routes.changePassword(mfaRequest({ currentPassword: password, password: next })));
        const current = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
        assert.equal(current.passwordHash, f.user.passwordHash); assert.equal(current.sessionVersion, f.user.sessionVersion);
        assert.equal((await db.passwordResetToken.findUniqueOrThrow({ where: { id: f.reset.id } })).usedAt, null);
        assert.equal(await db.auditEvent.count({ where: { actorId: f.user.id } }), 0); assert.equal(f.routes.sessionClears(), 0);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_password_audit_failure'); }
      assert.equal((await f.routes.changePassword(mfaRequest({ currentPassword: password, password: next }))).status, 200);
    });
    await t.test("overlapping reset and change leave exactly one committed credential", async () => {
      const f = await fixture(); let reads = 0, release!: () => void;
      const ready = new Promise<void>(r => { release = r; });
      const rendezvous = async <T>(value: T) => { if (++reads === 2) release(); await ready; return value; };
      const concurrent = await mfaLoginFixture({
        user: { findUnique: async (args: Parameters<typeof db.user.findUnique>[0]) => rendezvous(await db.user.findUnique(args)) },
        passwordResetToken: { findUnique: async (args: Parameters<typeof db.passwordResetToken.findUnique>[0]) => rendezvous(await db.passwordResetToken.findUnique(args)) },
        $transaction: db.$transaction.bind(db),
      }, f.session);
      const results = await Promise.allSettled([
        concurrent.changePassword(mfaRequest({ currentPassword: password, password: next })),
        concurrent.resetPassword(mfaRequest({ token: f.token, password: resetPassword })),
      ]);
      const winners = results.map((result, index) => result.status === "fulfilled" && result.value.status === 200 ? index : -1).filter(index => index >= 0);
      assert.equal(winners.length, 1);
      for (const result of results) {
        if (result.status === "rejected") assert.equal(result.reason?.code, "P2034");
        else assert.ok([200, 401, 410].includes(result.value.status));
      }
      const current = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
      assert.equal(await compare(winners[0] === 0 ? next : resetPassword, current.passwordHash!), true);
      assert.equal(current.sessionVersion, f.user.sessionVersion + 1);
      assert.equal(await db.auditEvent.count({ where: { actorId: f.user.id, action: { in: ["user.password.changed", "user.password_reset.completed"] } } }), 1);
      assert.ok((await db.passwordResetToken.findUniqueOrThrow({ where: { id: f.reset.id } })).usedAt);
    });
  } finally { await db.$disconnect(); }
});
