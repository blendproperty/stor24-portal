import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { hash } from "bcryptjs";
import { encryptMfaSecret, hashRecoveryCodes, totpCode } from "../src/lib/mfa";
import { mfaLoginFixture } from "./helpers/mfa-login-fixture";
import { mfaRequest } from "./helpers/mfa-routes-fixture";

test("signed MFA challenges reject missing, malformed, expired and wrong-context claims", async t => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-mfa-challenge-key-for-testing-only-20260925";
  t.after(() => { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; });
  const f = await mfaLoginFixture({});
  assert.equal(await f.getMfaChallenge(), null);
  await f.setMfaChallenge("synthetic", 0);
  assert.deepEqual(await f.getMfaChallenge(), { userId: "synthetic", sessionVersion: 0 });
  for (const version of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(f.setMfaChallenge("synthetic", version));
  await assert.rejects(f.setMfaChallenge("", 0));
  const sign = (claims: Record<string, unknown>, audience = "stor24-mfa", expiry = "5m") => new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setAudience(audience).setExpirationTime(expiry).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  for (const claims of [
    { userId: "synthetic", purpose: "mfa-login" },
    ...["0", null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(sessionVersion => ({ userId: "synthetic", purpose: "mfa-login", sessionVersion })),
    { userId: "", purpose: "mfa-login", sessionVersion: 0 },
    { userId: "synthetic", purpose: "session", sessionVersion: 0 },
  ]) { f.jar.set("stor24_mfa_challenge", await sign(claims)); assert.equal(await f.getMfaChallenge(), null); }
  const valid = { userId: "synthetic", purpose: "mfa-login", sessionVersion: 0 };
  for (const token of [await sign(valid, "wrong-audience"), await sign(valid, "stor24-mfa", "-1s"), "invalid.token.value"]) { f.jar.set("stor24_mfa_challenge", token); assert.equal(await f.getMfaChallenge(), null); }
});

test("actual login binds its password snapshot and verification rejects revocation before any MFA side effect", async t => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-mfa-revocation-route-key-for-testing-20260925";
  t.after(() => { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; });
  const secret = "JBSWY3DPEHPK3PXP", code = "ABCDE-12345", password = "Synthetic-Password-2026!";
  const user = { id: "synthetic", organisationId: "org", active: true, name: "Synthetic", email: "synthetic@example.invalid", passwordHash: await hash(password, 4), sessionVersion: 4, roleAssignments: [], mfaCredential: { enabledAt: new Date(), secretEncrypted: encryptMfaSecret(secret), recoveryCodeHashes: hashRecoveryCodes([code]) } };
  let revocationDuringLogin = false, revokeOnLock = false, writes = 0;
  const tx = {
    $queryRaw: async () => { if (revokeOnLock) { user.sessionVersion++; revokeOnLock = false; } return [{ id: user.id }]; },
    user: { findUnique: async () => structuredClone(user), findFirst: async () => { const snapshot = structuredClone(user); if (revocationDuringLogin) user.sessionVersion++; return snapshot; } },
    mfaCredential: { update: async ({ data }: { data: { recoveryCodeHashes: string[] } }) => { writes++; user.mfaCredential.recoveryCodeHashes = data.recoveryCodeHashes; return user.mfaCredential; } },
    auditEvent: { create: async () => { writes++; return {}; } },
  };
  const f = await mfaLoginFixture({ ...tx, $transaction: async <T>(op: (db: typeof tx) => Promise<T>) => op(tx) });
  revocationDuringLogin = true;
  assert.equal((await f.login(mfaRequest({ email: user.email, password }))).status, 200);
  assert.deepEqual(await f.getMfaChallenge(), { userId: user.id, sessionVersion: 4 });
  writes = 0;
  for (const input of [code, totpCode(secret)]) assert.equal((await f.verify(mfaRequest({ code: input }))).status, 401);
  assert.equal(writes, 0); assert.equal(f.sessions.length, 0); assert.deepEqual(user.mfaCredential.recoveryCodeHashes, hashRecoveryCodes([code]));
  await f.setMfaChallenge(user.id, user.sessionVersion); revokeOnLock = true;
  assert.equal((await f.verify(mfaRequest({ code }))).status, 401); assert.equal(writes, 0);
  revocationDuringLogin = false;
  assert.equal((await f.login(mfaRequest({ email: user.email, password }))).status, 200);
  assert.equal((await f.verify(mfaRequest({ code: totpCode(secret) }))).status, 200);
  assert.equal(f.sessions.at(-1)!.sessionVersion, user.sessionVersion); assert.equal(await f.getMfaChallenge(), null);
  assert.deepEqual(user.mfaCredential.recoveryCodeHashes, hashRecoveryCodes([code]));
  await f.setMfaChallenge(user.id, user.sessionVersion);
  assert.equal((await f.verify(mfaRequest({ code }))).status, 200); assert.deepEqual(user.mfaCredential.recoveryCodeHashes, []);
});
