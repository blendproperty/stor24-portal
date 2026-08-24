import { createHmac, timingSafeEqual } from "node:crypto";

export function validBlendSignWebhookSignature(body: string, header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const supplied = header.slice(7);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"));
}
