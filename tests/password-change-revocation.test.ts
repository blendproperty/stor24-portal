import assert from "node:assert/strict";
import test from "node:test";
import { compare, hash } from "bcryptjs";
import { mfaLoginFixture } from "./helpers/mfa-login-fixture";
import { mfaRequest } from "./helpers/mfa-routes-fixture";

test("password changes bind the current credential and authorization snapshot", async () => {
  const password = "Original-Synthetic-Password-2026!", next = "Changed-Synthetic-Password-2026!";
  const initial = { id: "synthetic", organisationId: "org", active: true, sessionVersion: 0, passwordHash: await hash(password, 4), roleAssignments: [] };
  for (const mutation of [{ sessionVersion: 1 }, { active: false }, { organisationId: "other" }, { passwordHash: await hash("Reset-Winner-Password-2026!", 4) }]) {
    let user = structuredClone(initial), tokens = 0, audits = 0;
    const tx = { user: { updateMany: async ({ where }: { where: Record<string, unknown> }) => ({ count: Object.entries(where).every(([key, value]) => user[key as keyof typeof user] === value) ? 1 : 0 }) }, passwordResetToken: { updateMany: async () => { tokens++; } }, auditEvent: { create: async () => { audits++; } } };
    const db = { user: { findUnique: async () => { const snapshot = structuredClone(user); user = { ...user, ...mutation }; return snapshot; } }, $transaction: async <T>(op: (client: typeof tx) => Promise<T>) => op(tx) };
    const f = await mfaLoginFixture(db, { userId: initial.id, sessionVersion: 0 });
    const response = await f.changePassword(mfaRequest({ currentPassword: password, password: next }));
    assert.equal(response.status, 401); assert.equal(typeof (await response.json()).error, "string");
    assert.equal(tokens, 0); assert.equal(audits, 0); assert.equal(f.sessionClears(), 0);
    assert.equal(await compare(next, user.passwordHash), false);
  }
  let user = structuredClone(initial), tokens = 0, audits = 0;
  const tx = { user: { updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { passwordHash: string } }) => { assert.equal(where.passwordHash, initial.passwordHash); assert.equal(where.sessionVersion, 0); user = { ...user, passwordHash: data.passwordHash, sessionVersion: user.sessionVersion + 1 }; return { count: 1 }; } }, passwordResetToken: { updateMany: async () => { tokens++; } }, auditEvent: { create: async () => { audits++; } } };
  const f = await mfaLoginFixture({ user: { findUnique: async () => structuredClone(user) }, $transaction: async <T>(op: (client: typeof tx) => Promise<T>) => op(tx) }, { userId: initial.id, sessionVersion: 0 });
  assert.equal((await f.changePassword(mfaRequest({ currentPassword: "wrong", password: next }))).status, 422);
  assert.equal((await f.changePassword(mfaRequest({ currentPassword: password, password: next }))).status, 200);
  assert.equal(await compare(next, user.passwordHash), true); assert.equal(user.sessionVersion, 1);
  assert.equal(tokens, 1); assert.equal(audits, 1); assert.equal(f.sessionClears(), 1);
});
