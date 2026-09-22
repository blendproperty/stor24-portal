import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";

export const ID_PAGE_LIMIT = 6 * 1024 * 1024;
export const ID_REQUEST_LIMIT = 2 * ID_PAGE_LIMIT + 64 * 1024;
export const identityTypes = ["ID_CARD", "ID_BOOKLET", "PASSPORT"] as const;
const policySchema = z.object({
  enabled: z.literal(true), fullCopyApproved: z.literal(true), version: z.string().min(1).max(100),
  effectiveFrom: z.iso.datetime(), approvalReference: z.string().min(1).max(300),
  notice: z.string().min(40).max(12000), acknowledgementLabel: z.string().min(15).max(1000),
  retentionHours: z.number().int().min(1).max(2160), alternativeContact: z.string().min(1).max(500),
  acceptedTypes: z.array(z.enum(identityTypes)).min(1).max(3),
});
export function identityPolicy(organisationId: string) {
  if (!process.env.IDENTITY_DOCUMENT_POLICIES_JSON) return null;
  try {
    const policies = JSON.parse(process.env.IDENTITY_DOCUMENT_POLICIES_JSON);
    if (!policies || typeof policies !== "object" || Array.isArray(policies)) throw new Error();
    if (!Object.hasOwn(policies, organisationId)) return null;
    const policy = policySchema.parse(policies[organisationId]);
    return { ...policy, hash: createHash("sha256").update(JSON.stringify(policy)).digest("hex") };
  } catch { throw new Error("ID_POLICY_UNAVAILABLE"); }
}
export function identityRequired(organisationId: string, createdAt: Date) {
  const policy = identityPolicy(organisationId);
  return policy && createdAt >= new Date(policy.effectiveFrom) ? policy : null;
}
export function newIdentityAccess() {
  const token = randomBytes(32).toString("base64url");
  return { token, identityAccessHash: createHash("sha256").update(token).digest("hex"), identityAccessExpiresAt: new Date(Date.now() + 60 * 60 * 1000) };
}
export function identityAccessMatches(token: string, hash: string | null, expiresAt: Date | null) {
  return /^[A-Za-z0-9_-]{43}$/.test(token) && Boolean(hash && /^[a-f0-9]{64}$/.test(hash) && expiresAt && expiresAt > new Date() && timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(hash, "hex")));
}
function key() {
  const secret = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("ID_POLICY_UNAVAILABLE");
  return createHash("sha256").update(`stor24:identity-document:v1:${secret}`).digest();
}
export function encryptIdentity(bytes: Buffer, binding: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptIdentity(value: string, binding: string) {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1") throw new Error("ID_CHANGED");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  cipher.setAAD(Buffer.from(binding)); cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(body, "base64url")), cipher.final()]);
}
export async function normaliseIdentityPage(file: File) {
  if (!(file instanceof File) || !["image/jpeg", "image/png"].includes(file.type) || file.size < 1 || file.size > ID_PAGE_LIMIT) throw new Error("ID_INVALID");
  const original = Buffer.from(await file.arrayBuffer());
  try {
    const image = sharp(original, { limitInputPixels: 24_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 || Math.min(metadata.width ?? 0, metadata.height ?? 0) < 400) throw new Error();
    return await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 95 }).toBuffer();
  } catch { throw new Error("ID_INVALID"); } finally { original.fill(0); }
}
export async function boundedIdentityForm(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error("ID_INVALID");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > ID_REQUEST_LIMIT) { await reader.cancel(); throw new Error(); }
      chunks.push(item.value);
    }
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  } catch { throw new Error("ID_INVALID"); } finally { chunks.forEach(chunk => chunk.fill(0)); }
}
