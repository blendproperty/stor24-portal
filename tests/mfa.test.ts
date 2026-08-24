import test from "node:test";
import assert from "node:assert/strict";
import { consumeRecoveryCode, decryptMfaSecret, encryptMfaSecret, hashRecoveryCodes, totpCode, verifyTotp } from "../src/lib/mfa.ts";

process.env.AUTH_SECRET = "test-auth-secret-longer-than-thirty-two-characters";

test("TOTP matches RFC 6238 SHA1 vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(secret, 59_000, 8), "94287082");
  const sixDigit = totpCode(secret, 59_000);
  assert.equal(verifyTotp(secret, sixDigit, 59_000), true);
  assert.equal(verifyTotp(secret, "000000", 59_000), false);
});

test("MFA secrets are authenticated and encrypted at rest", () => {
  const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
  assert.notEqual(encrypted.includes("JBSWY3DPEHPK3PXP"), true);
  assert.equal(decryptMfaSecret(encrypted), "JBSWY3DPEHPK3PXP");
  const [version, iv, tag, ciphertext] = encrypted.split(".");
  const tamperedBytes = Buffer.from(ciphertext, "base64url");
  tamperedBytes[0] ^= 0x01;
  assert.throws(() => decryptMfaSecret([version, iv, tag, tamperedBytes.toString("base64url")].join(".")));
});

test("recovery codes are one-time and stored only as hashes", () => {
  const hashes = hashRecoveryCodes(["ABCDE-12345", "FGHIJ-67890"]);
  assert.equal(hashes.some((value) => value.includes("ABCDE")), false);
  const remaining = consumeRecoveryCode(hashes, "abcde 12345");
  assert.equal(remaining?.length, 1);
  assert.equal(consumeRecoveryCode(remaining ?? [], "ABCDE-12345"), null);
});
