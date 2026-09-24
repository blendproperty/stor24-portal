import assert from "node:assert/strict";
import test from "node:test";
import { encryptPhoto, decryptPhoto } from "../src/lib/facial-photo-security";
import { encryptIdentity, decryptIdentity } from "../src/lib/identity-document-security";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "../src/lib/integrations/integration-secret-vault";
import { encryptMfaSecret, decryptMfaSecret } from "../src/lib/mfa";

test("encrypted records preserve full-tag compatibility and reject shortened or changed tags", () => {
  const previous = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
  const previousAuth = process.env.AUTH_SECRET;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "synthetic-encryption-regression-key-not-for-live";
  process.env.AUTH_SECRET = "synthetic-auth-regression-key-not-for-live";
  try {
    const value = "synthetic private value";
    const cases = [
      [() => encryptPhoto(Buffer.from(value), "booking:one"), (v: string) => decryptPhoto(v, "booking:one").toString()],
      [() => encryptIdentity(Buffer.from(value), "booking:one"), (v: string) => decryptIdentity(v, "booking:one").toString()],
      [() => encryptIntegrationSecret(value), decryptIntegrationSecret],
      [() => encryptMfaSecret(value), decryptMfaSecret],
    ] as const;
    for (const [encrypt, decrypt] of cases) {
      const encrypted = encrypt();
      assert.equal(decrypt(encrypted), value);
      const parts = encrypted.split(".");
      const tag = Buffer.from(parts[2], "base64url");
      assert.equal(tag.length, 16);
      for (const length of [4, 8, 12, 15]) {
        const shortened = [...parts]; shortened[2] = tag.subarray(0, length).toString("base64url");
        assert.throws(() => decrypt(shortened.join(".")), `must reject ${length}-byte tag`);
      }
      const changed = [...parts]; tag[0] ^= 1; changed[2] = tag.toString("base64url");
      assert.throws(() => decrypt(changed.join(".")));
    }
  } finally {
    if (previous === undefined) delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY; else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = previous;
    if (previousAuth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousAuth;
  }
});
