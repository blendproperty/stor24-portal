import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "bcryptjs";
import { mfaLoginFixture } from "./helpers/mfa-login-fixture";
import { mfaRequest, mfaRoutesFixture } from "./helpers/mfa-routes-fixture";
import { acceptInvitationSchema, changePasswordSchema, loginSchema, ownerSetupSchema, resetPasswordSchema } from "../src/lib/validators";

test("passwordless accounts never receive a staff session or MFA challenge", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-password-boundary-key-01234567890123456789";
  try {
    for (const passwordHash of [null, ""]) for (const enabled of [false, true]) {
      const user = { id: "synthetic", organisationId: "org", name: "Test", email: "staff@example.invalid", active: true, sessionVersion: 0, passwordHash, roleAssignments: [], mfaCredential: enabled ? { enabledAt: new Date() } : null };
      const audits: string[] = [];
      const f = await mfaLoginFixture({ user: { findFirst: async () => user }, auditEvent: { create: async ({ data }: { data: { action: string } }) => { audits.push(data.action); } } });
      const response = await f.login(mfaRequest({ email: user.email, password: "constant-time-invalid-password" }));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Email or password is incorrect." });
      assert.equal(f.sessions.length, 0); assert.equal(f.jar.size, 0);
      assert.deepEqual(audits, ["user.login.failed"]);
    }
    const missing = await mfaLoginFixture({ user: { findFirst: async () => null } });
    assert.equal((await missing.login(mfaRequest({ email: "unknown@example.invalid", password: "constant-time-invalid-password" }))).status, 401);
    assert.equal(missing.sessions.length, 0); assert.equal(missing.jar.size, 0);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

test("real passwords retain MFA routing and legacy long-password login", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "synthetic-password-boundary-key-01234567890123456789";
  try {
    // Existing long passwords must remain usable until the owner replaces them.
    const password = "A1!" + "a".repeat(80);
    const passwordHash = await hash(password, 4);
    for (const enabled of [false, true]) {
      const user = { id: "synthetic", organisationId: "org", name: "Test", email: "staff@example.invalid", active: true, sessionVersion: 2, passwordHash, roleAssignments: [], mfaCredential: enabled ? { enabledAt: new Date() } : null };
      const f = await mfaLoginFixture({ user: { findFirst: async () => user }, auditEvent: { create: async () => ({}) } });
      assert.equal((await f.login(mfaRequest({ email: user.email, password: "wrong" }))).status, 401);
      assert.equal(f.sessions.length, 0); assert.equal(f.jar.size, 0);
      const response = await f.login(mfaRequest({ email: user.email, password }));
      assert.equal(response.status, 200);
      assert.equal(f.sessions.length, enabled ? 0 : 1);
      assert.equal(f.jar.size, enabled ? 1 : 0);
      if (enabled) assert.deepEqual(await f.getMfaChallenge(), { userId: user.id, sessionVersion: 2 });
    }
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

test("all new-password paths reject bcrypt truncation including UTF-8 boundaries", () => {
  const token = "a".repeat(32);
  const schemas = [
    (password: string) => acceptInvitationSchema.safeParse({ token, password }),
    (password: string) => ownerSetupSchema.safeParse({ token, name: "Synthetic", email: "staff@example.invalid", password }),
    (password: string) => resetPasswordSchema.safeParse({ token, password }),
    (password: string) => changePasswordSchema.safeParse({ currentPassword: "a".repeat(100), password }),
  ];
  for (const parse of schemas) {
    for (const value of ["A1!" + "a".repeat(69), "A1!" + "é".repeat(34) + "a"]) {
      assert.equal(new TextEncoder().encode(value).length, 72);
      assert.equal(parse(value).success, true);
      assert.equal(parse(value + "x").success, false);
      assert.equal(parse(value + "é").success, false);
    }
    assert.equal(parse("A1!" + "😀".repeat(18)).success, false);
  }
  assert.equal(loginSchema.safeParse({ email: "staff@example.invalid", password: "a".repeat(100) }).success, true);
});

test("previously issued MFA challenges and setup cookies cannot revive a passwordless user", async () => {
  let sessions = 0, clears = 0;
  const user = { id: "synthetic", organisationId: "org", active: true, passwordHash: null, sessionVersion: 1, roleAssignments: [], mfaCredential: { enabledAt: new Date(), secretEncrypted: "must-not-be-decrypted", recoveryCodeHashes: [] } };
  const tx = { user: { findUnique: async () => user }, $queryRaw: async () => [{ id: user.id }] };
  const db = { ...tx, $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx) };
  const routes = await mfaRoutesFixture(db, { getSession: async () => ({ userId: user.id, sessionVersion: 1, mfaVerified: true }), setSession: async () => { sessions++; }, getChallenge: async () => ({ userId: user.id, sessionVersion: 1 }), clearChallenge: async () => { clears++; } });
  assert.equal((await routes.verify(mfaRequest({ code: "123456" }))).status, 401);
  assert.equal((await routes.manage(mfaRequest({ action: "begin" }))).status, 401);
  assert.equal(sessions, 0); assert.equal(clears, 0);
});
