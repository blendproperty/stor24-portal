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
  const source = `${appUrl}${routePath}${suffix}${sorted.map(([key, value]) => `${key}${value}`).join("")}`;
  const expected = createHmac("sha1", token).update(source).digest("base64");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function formObject(entries: ReadonlyArray<readonly [string, string]>) {
  return Object.fromEntries(entries);
}
