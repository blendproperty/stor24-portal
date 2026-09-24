import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const policySchema = z.object({
  enabled: z.literal(true), version: z.string().trim().min(1).max(100),
  notice: z.string().trim().min(40).max(12000),
  consentLabel: z.string().trim().min(15).max(1000),
  approvalReference: z.string().trim().min(1).max(300),
  retentionHours: z.number().int().min(1).max(24 * 90),
  alternativeContact: z.string().trim().min(1).max(500),
});

/** No built-in consent text or retention default: these are legal decisions. */
export function facialPhotoPolicy(organisationId: string) {
  try {
    const policies = JSON.parse(process.env.FACIAL_ACCESS_POLICIES_JSON ?? "{}");
    const parsed = policySchema.safeParse(policies[organisationId]);
    if (!parsed.success) return null;
    return { ...parsed.data, hash: createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex") };
  } catch { return null; }
}

function photoKey() {
  const secret = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("PHOTO_STORAGE_UNAVAILABLE");
  return createHash("sha256").update(`stor24:facial-photo:v1:${secret}`).digest();
}
export function encryptPhoto(bytes: Buffer, binding: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", photoKey(), iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptPhoto(value: string, binding: string) {
  const [version, iv, tag, data, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra) throw new Error("PHOTO_STORAGE_UNAVAILABLE");
  const cipher = createDecipheriv("aes-256-gcm", photoKey(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  cipher.setAAD(Buffer.from(binding)); cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]);
}
export async function normaliseFacialPhoto(file: File) {
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error("PHOTO_INVALID");
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("PHOTO_INVALID");
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { limitInputPixels: 16_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 160) throw new Error("invalid");
    // Decode all pixels, orient, resize and re-encode. Metadata/EXIF is discarded.
    return await image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch { throw new Error("PHOTO_INVALID"); }
}

/** Enforce the actual byte count, including chunked requests, before parsing multipart. */
export async function boundedPhotoForm(request: Request) {
  const limit = MAX_PHOTO_BYTES + 32 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > limit || !request.body) throw new Error("PHOTO_INVALID");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("PHOTO_INVALID"); }
      chunks.push(next.value);
    }
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  } catch { throw new Error("PHOTO_INVALID"); }
}
