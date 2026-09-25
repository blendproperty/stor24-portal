import assert from "node:assert/strict";
import test from "node:test";
import { mfaRequest, mfaRoutesFixture } from "./helpers/mfa-routes-fixture";

test("actual MFA routes serialize one-time recovery and roll back audit failures", async t => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-mfa-atomicity-key-not-production-20260925";
  t.after(() => { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; });
  let credential: { enabledAt: Date | null; secretEncrypted: string; recoveryCodeHashes: string[] } | null = null;
  let version = 0, failAudit = false, sessions = 0, cleared = 0;
  let audits: string[] = [], tail = Promise.resolve();
  const user = () => ({ id: "synthetic", organisationId: "org", active: true, name: "Synthetic", email: "synthetic@example.invalid", passwordHash: null, sessionVersion: version, roleAssignments: [], mfaCredential: structuredClone(credential) });
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { assert.match(strings.join("?"), /User.*FOR UPDATE/); return [{ id: "synthetic" }]; },
    user: { findUnique: async () => user(), update: async () => { version++; return user(); } },
    mfaCredential: {
      findUnique: async () => structuredClone(credential),
      update: async ({ data }: { data: Partial<NonNullable<typeof credential>> }) => { assert.ok(credential); credential = { ...credential, ...data }; return credential; },
      upsert: async ({ create, update }: { create: NonNullable<typeof credential>; update: NonNullable<typeof credential> }) => { credential = credential ? { ...credential, ...update } : { ...create }; return credential; },
      delete: async () => { const value = credential; credential = null; return value; },
    },
    auditEvent: { create: async ({ data }: { data: { action: string } }) => { if (failAudit) throw Error("SYNTHETIC_AUDIT_FAILURE"); audits.push(data.action); return {}; } },
  };
  const db = { ...tx, $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => {
    const before = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await before;
    const snapshot = { credential: structuredClone(credential), audits: [...audits], version };
    try { return await operation(tx); } catch (error) { credential = snapshot.credential; audits = snapshot.audits; version = snapshot.version; throw error; } finally { release(); }
  } };
  const routes = await mfaRoutesFixture(db, { getSession: async () => ({ userId: "synthetic", sessionVersion: version }), getChallenge: async () => ({ userId: "synthetic", sessionVersion: 0 }), setSession: async () => { sessions++; }, clearChallenge: async () => { cleared++; } });
  const secret = "JBSWY3DPEHPK3PXP", codes = ["ABCDE-12345", "ABCDE-67890"];
  const reset = () => { credential = { enabledAt: new Date(), secretEncrypted: routes.encryptMfaSecret(secret), recoveryCodeHashes: routes.hashRecoveryCodes(codes) }; audits = []; sessions = 0; cleared = 0; failAudit = false; };
  reset();
  const burst = await Promise.all(Array.from({ length: 8 }, () => routes.verify(mfaRequest({ code: codes[0] }))));
  assert.equal(burst.filter(r => r.status === 200).length, 1); assert.equal(sessions, 1); assert.equal(cleared, 1);
  assert.equal(audits.filter(a => a === "user.login.recovery_code_used").length, 1);
  assert.deepEqual(credential!.recoveryCodeHashes, routes.hashRecoveryCodes([codes[1]]));
  reset();
  assert.deepEqual((await Promise.all(codes.map(code => routes.verify(mfaRequest({ code }))))).map(r => r.status), [200, 200]);
  assert.deepEqual(credential!.recoveryCodeHashes, []);
  reset(); failAudit = true;
  await assert.rejects(routes.verify(mfaRequest({ code: codes[0] })), /SYNTHETIC_AUDIT_FAILURE/);
  assert.deepEqual(credential!.recoveryCodeHashes, routes.hashRecoveryCodes(codes)); assert.equal(sessions, 0); assert.equal(cleared, 0);
  failAudit = false; assert.equal((await routes.verify(mfaRequest({ code: codes[0] }))).status, 200);
  reset();
  assert.equal((await routes.verify(mfaRequest({ code: routes.totpCode(secret) }))).status, 200);
  assert.deepEqual(credential!.recoveryCodeHashes, routes.hashRecoveryCodes(codes));
  reset();
  const mixed = await Promise.all([routes.verify(mfaRequest({ code: codes[0] })), routes.manage(mfaRequest({ action: "regenerate", code: codes[0] }))]);
  assert.equal(mixed.filter(r => r.status === 200).length, 1);
  assert.equal((await routes.manage(mfaRequest({ action: "begin" }))).status, 409);
  failAudit = true;
  assert.equal((await routes.manage(mfaRequest({ action: "regenerate", code: routes.totpCode(secret) }))).status, 500);
  assert.deepEqual(credential!.recoveryCodeHashes, routes.hashRecoveryCodes([codes[1]]));
});