import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey() {
  const source = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim();
  if (!source || source.length < 32) throw new Error("CONFIG_REQUIRED:INTEGRATION_CONFIG_ENCRYPTION_KEY");
  return createHash("sha256").update(source, "utf8").digest();
}

export function encryptIntegrationSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptIntegrationSecret(value: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue || extra) throw new Error("INTEGRATION_SECRET_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

export function integrationEncryptionConfigured() {
  return Boolean(process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim() && process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY!.trim().length >= 32);
}
