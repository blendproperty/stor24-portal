import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { createSessionToken, verifySessionToken } from "../src/lib/session.ts";

const secret = "synthetic-session-test-key-01234567890123456789";
const claims = { userId: "synthetic-staff", name: "Test", email: "staff@example.invalid", role: "Facility manager", sessionVersion: 1 };

test("staff session signature, expiry, algorithm and required claims are enforced", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = secret;
  try {
    const valid = await createSessionToken(claims);
    assert.equal((await verifySessionToken(valid))?.userId, claims.userId);
    assert.equal(await verifySessionToken(), null);
    assert.equal(await verifySessionToken("not-a-token"), null);
    const sign = (payload: Record<string, unknown>, algorithm = "HS256", key = secret, expires = "1h") =>
      new SignJWT(payload).setProtectedHeader({ alg: algorithm }).setIssuedAt().setExpirationTime(expires).sign(new TextEncoder().encode(key));
    assert.equal(await verifySessionToken(await sign(claims, "HS256", secret, "-1s")), null);
    assert.equal(await verifySessionToken(await sign(claims, "HS384")), null);
    assert.equal(await verifySessionToken(await sign(claims, "HS256", secret + "wrong")), null);
    for (const required of Object.keys(claims)) {
      const incomplete: Record<string, unknown> = { ...claims };
      delete incomplete[required];
      assert.equal(await verifySessionToken(await sign(incomplete)), null, required);
    }
    assert.equal(await verifySessionToken(await sign({ ...claims, sessionVersion: "1" })), null);
    process.env.AUTH_SECRET = "short";
    assert.equal(await verifySessionToken(valid), null);
    await assert.rejects(createSessionToken(claims), /AUTH_SECRET/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});
