import { createHmac, timingSafeEqual } from "node:crypto";

export function formEntries(form: FormData) {
  return [...form.entries()].map(([key, value]) => [key, String(value)] as const);
}

export function validTwilioSignature(request: Request, entries: ReadonlyArray<readonly [string, string]>, routePath: string) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const supplied = request.headers.get("x-twilio-signature");
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!token || !supplied || !appUrl) return false;
  const suffix = new URL(request.url).search;
  const sorted = [...entries].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const left = Buffer.from(supplied);
  // In-flight/provider-configured callbacks can retain the previous hostname.
  // Only server-configured origins are trusted, never forwarded request headers.
  const origins = [appUrl, process.env.TWILIO_LEGACY_WEBHOOK_ORIGIN].filter((value): value is string => Boolean(value));
  return origins.some(value => {
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.origin !== value.replace(/\/$/, "")) return false;
      const source = `${url.origin}${routePath}${suffix}${sorted.map(([key, entry]) => `${key}${entry}`).join("")}`;
      const right = Buffer.from(createHmac("sha1", token).update(source).digest("base64"));
      return left.length === right.length && timingSafeEqual(left, right);
    } catch { return false; }
  });
}

export function formObject(entries: ReadonlyArray<readonly [string, string]>) {
  return Object.fromEntries(entries);
}
