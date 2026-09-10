import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import { verifyTenantChallenge, tenantSessionForToken } from "../src/lib/tenant-portal-auth";
import { tenantCodeHash, tenantTokenHash } from "../src/lib/tenant-portal-security";

test("OTP verification consumes once, rejects expired/exhausted and changed owners", async () => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "isolated-test-secret-not-used-in-production";
  let attempts = 0, consumed = false, expired = false, eligible = true;
  const sessions: { tokenHash: string; customerIds: string[] }[] = [];
  const id = "test-challenge";
  const fake = { tenantPortalChallenge: { updateMany: async () => {
    if (consumed || expired || attempts >= 5) return { count: 0 };
    attempts++; return { count: 1 };
  }, findUnique: async () => ({ id, email: "test@example.invalid", organisationId: "org", customerIds: ["own"], codeHash: tenantCodeHash(id, "123456") }) },
  customer: { findMany: async (query: { where: unknown }) => {
    assert.deepEqual(query.where, { organisationId: "org", id: { in: ["own"] }, email: { equals: "test@example.invalid", mode: "insensitive" }, emailVerifiedAt: { not: null } });
    return eligible ? [{ id: "own" }] : [];
  } }, $transaction: async (work: (tx: unknown) => Promise<void>) => work({
    tenantPortalChallenge: { updateMany: async () => { if (consumed) return { count: 0 }; consumed = true; return { count: 1 }; } },
    tenantPortalSession: { create: async ({ data }: { data: { tokenHash: string; customerIds: string[] } }) => { sessions.push(data); } },
    auditEvent: { create: async () => ({}) },
  }) } as unknown as typeof db;
  const verify = (challenge: string, code: string) => verifyTenantChallenge(challenge, code, fake);
  try {
    await assert.rejects(verify(id, "654321"), /INVALID_CODE/);
    assert.equal(sessions.length, 0);
    eligible = false;
    await assert.rejects(verify(id, "123456"), /INVALID_CODE/);
    eligible = true;
    const token = await verify(id, "123456");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].tokenHash, tenantTokenHash(token));
    assert.deepEqual(sessions[0].customerIds, ["own"]);
    await assert.rejects(verify(id, "123456"), /INVALID_CODE/);
    consumed = false; expired = true;
    await assert.rejects(verify(id, "123456"), /INVALID_CODE/);
    expired = false; attempts = 5;
    await assert.rejects(verify(id, "123456"), /INVALID_CODE/);
    assert.equal(sessions.length, 1);
  } finally { if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret; }
});

test("tenant session denies staff JWTs, revoked sessions and changed email ownership", async () => {
  let active = true, eligible = true;
  const token = "a".repeat(64);
  const fake = {
    tenantPortalSession: { findFirst: async ({ where }: { where: { tokenHash: string; revokedAt: null; expiresAt: { gt: Date } } }) => {
      assert.equal(where.tokenHash, tenantTokenHash(token));
      assert.equal(where.revokedAt, null);
      assert.ok(where.expiresAt.gt instanceof Date);
      return active ? { organisationId: "org", email: "test@example.invalid", customerIds: ["own", "changed"] } : null;
    } },
    customer: { findMany: async ({ where }: { where: { organisationId: string; email: { equals: string }; id: { in: string[] } } }) => {
      assert.equal(where.organisationId, "org"); assert.equal(where.email.equals, "test@example.invalid");
      assert.deepEqual(where.id.in, ["own", "changed"]);
      return eligible ? [{ id: "own" }] : [];
    } },
  } as unknown as typeof db;
  await assert.rejects(tenantSessionForToken(undefined, fake), /UNAUTHENTICATED/);
  await assert.rejects(tenantSessionForToken("header.payload.signature", fake), /UNAUTHENTICATED/);
  const session = await tenantSessionForToken(token, fake);
  assert.deepEqual(session.customerIds, ["own"]);
  eligible = false;
  await assert.rejects(tenantSessionForToken(token, fake), /UNAUTHENTICATED/);
  eligible = true; active = false;
  await assert.rejects(tenantSessionForToken(token, fake), /UNAUTHENTICATED/);
});
