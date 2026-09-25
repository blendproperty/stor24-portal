import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { db } from "../../src/lib/db";
import { encryptMfaSecret, hashRecoveryCodes, totpCode } from "../../src/lib/mfa";
import { mfaRequest, mfaRoutesFixture } from "../helpers/mfa-routes-fixture";

test("isolated PostgreSQL MFA one-time recovery and credential lifecycle", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const priorSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-mfa-database-key-not-production-20260925";
  const secret = "JBSWY3DPEHPK3PXP", codes = ["ABCDE-12345", "ABCDE-67890"], password = "synthetic-only-password";
  async function fixture(enabled = true) {
    const key = randomUUID(), org = await db.organisation.create({ data: { name: "MFA synthetic CI", slug: key } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic MFA", email: `${key}@example.invalid`, passwordHash: await hash(password, 4) } });
    await db.mfaCredential.create({ data: { userId: user.id, enabledAt: enabled ? new Date() : null, secretEncrypted: encryptMfaSecret(secret), recoveryCodeHashes: enabled ? hashRecoveryCodes(codes) : [] } });
    const sessions: { sessionVersion: number }[] = []; let clears = 0;
    const routes = await mfaRoutesFixture(db, { getSession: async () => ({ userId: user.id, sessionVersion: user.sessionVersion }), setSession: async value => { sessions.push(value as { sessionVersion: number }); }, getChallenge: async () => user.id, clearChallenge: async () => { clears++; } });
    return { org, user, routes, sessions, clears: () => clears, credential: () => db.mfaCredential.findUnique({ where: { userId: user.id } }) };
  }
  try {
    await t.test("same code creates one session; different concurrent codes are both consumed", async () => {
      const f = await fixture();
      const responses = await Promise.all(Array.from({ length: 8 }, () => f.routes.verify(mfaRequest({ code: codes[0] }))));
      assert.equal(responses.filter(r => r.status === 200).length, 1); assert.equal(f.sessions.length, 1); assert.equal(f.clears(), 1);
      assert.equal(await db.auditEvent.count({ where: { actorId: f.user.id, action: "user.login.recovery_code_used" } }), 1);
      assert.equal(await db.auditEvent.count({ where: { actorId: f.user.id, action: "user.login.succeeded" } }), 1);
      assert.deepEqual((await f.credential())!.recoveryCodeHashes, hashRecoveryCodes([codes[1]]));
      const other = await fixture();
      assert.deepEqual((await Promise.all(codes.map(code => other.routes.verify(mfaRequest({ code }))))).map(r => r.status), [200, 200]);
      assert.deepEqual((await other.credential())!.recoveryCodeHashes, []);
    });
    await t.test("login and regeneration cannot reuse proof or restore an old code list", async () => {
      const f = await fixture();
      const [login, regenerated] = await Promise.all([f.routes.verify(mfaRequest({ code: codes[0] })), f.routes.manage(mfaRequest({ action: "regenerate", code: codes[0] }))]);
      assert.equal([login, regenerated].filter(r => r.status === 200).length, 1);
      if (regenerated.status === 200) assert.deepEqual((await f.credential())!.recoveryCodeHashes, hashRecoveryCodes((await regenerated.json()).data.recoveryCodes));
      else assert.deepEqual((await f.credential())!.recoveryCodeHashes, hashRecoveryCodes([codes[1]]));
      const other = await fixture();
      const [before, after] = await Promise.all([other.routes.verify(mfaRequest({ code: codes[0] })), other.routes.manage(mfaRequest({ action: "regenerate", code: totpCode(secret) }))]);
      assert.ok([200, 401].includes(before.status)); assert.equal(after.status, 200);
      assert.deepEqual((await other.credential())!.recoveryCodeHashes, hashRecoveryCodes((await after.json()).data.recoveryCodes));
    });
    await t.test("disable consumes the current proof and invalidates a previously committed session", async () => {
      const f = await fixture();
      const results = await Promise.all([f.routes.verify(mfaRequest({ code: codes[0] })), f.routes.manage(mfaRequest({ action: "disable", code: codes[0], password }))]);
      assert.equal(results.filter(r => r.status === 200).length, 1);
      const other = await fixture();
      const [login, disabled] = await Promise.all([other.routes.verify(mfaRequest({ code: codes[0] })), other.routes.manage(mfaRequest({ action: "disable", code: totpCode(secret), password }))]);
      assert.ok([200, 401].includes(login.status)); assert.equal(disabled.status, 200); assert.equal(await other.credential(), null);
      const current = await db.user.findUniqueOrThrow({ where: { id: other.user.id } });
      assert.equal(current.sessionVersion, other.user.sessionVersion + 1);
      for (const session of other.sessions) assert.notEqual(session.sessionVersion, current.sessionVersion);
      assert.equal((await other.routes.manage(mfaRequest({ action: "begin" }))).status, 401);
    });
    await t.test("concurrent enrollment cannot overwrite a committed enabled credential", async () => {
      const f = await fixture(false);
      const [enabled, begun] = await Promise.all([f.routes.manage(mfaRequest({ action: "enable", code: totpCode(secret) })), f.routes.manage(mfaRequest({ action: "begin" }))]);
      assert.ok([200, 422].includes(enabled.status)); assert.ok([200, 409].includes(begun.status));
      if (enabled.status === 200) assert.ok((await f.credential())!.enabledAt);
      else { assert.equal(begun.status, 200); assert.equal((await f.credential())!.enabledAt, null); }
    });
    await t.test("audit failures roll back every credential mutation and session version", async () => {
      for (const action of ["verify", "begin", "enable", "regenerate", "disable"]) {
        const f = await fixture(action !== "enable" && action !== "begin");
        if (action === "begin") await db.mfaCredential.delete({ where: { userId: f.user.id } });
        const before = await f.credential();
        const call = () => action === "verify" ? f.routes.verify(mfaRequest({ code: codes[0] })) : f.routes.manage(mfaRequest({ action, code: totpCode(secret), password }));
        await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_mfa_audit_failure CHECK (false) NOT VALID');
        try {
          if (action === "verify") await assert.rejects(call()); else assert.equal((await call()).status, 500);
          assert.deepEqual(await f.credential(), before);
          assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).sessionVersion, f.user.sessionVersion);
          assert.equal(await db.auditEvent.count({ where: { actorId: f.user.id } }), 0);
          assert.equal(f.sessions.length, 0); assert.equal(f.clears(), 0);
        } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_mfa_audit_failure'); }
        assert.equal((await call()).status, 200);
      }
    });
    await t.test("valid TOTP leaves recovery codes intact and invalid proof remains denied", async () => {
      const f = await fixture();
      assert.equal((await f.routes.verify(mfaRequest({ code: "invalid" }))).status, 401);
      assert.equal((await f.routes.verify(mfaRequest({ code: totpCode(secret) }))).status, 200);
      assert.deepEqual((await f.credential())!.recoveryCodeHashes, hashRecoveryCodes(codes));
      assert.equal((await f.routes.manage(mfaRequest({ action: "enable", code: totpCode(secret) }))).status, 409);
    });
  } finally {
    if (priorSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = priorSecret;
    await db.$disconnect();
  }
});