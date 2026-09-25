import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
export function privacyHash(value: string) {
  return createHash("sha256").update(`${process.env.AUTH_SECRET}:${value}`).digest("hex");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for mutating requests. Browsers always send an Origin header on
 * same-site fetch/XHR/form submissions for non-safe methods, so a missing
 * Origin on a mutating request is treated as untrusted rather than allowed
 * through. Safe methods (GET/HEAD/OPTIONS) are exempt since they must not
 * have side effects.
 */
export function sameOrigin(request: Request) {
  if (SAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin, process.env.APP_URL].filter(Boolean));
  return allowed.has(origin);
}

/** Atomically claim an attempt; a denied request leaves the fixed window unchanged. */
export async function rateLimit(key: string, limit: number, windowMs: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2_147_483_647 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("INVALID_RATE_LIMIT");
  const now = new Date(), resetAt = new Date(now.getTime() + windowMs);
  if (!Number.isFinite(resetAt.getTime())) throw new Error("INVALID_RATE_LIMIT");
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt") VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END,
      "updatedAt" = ${now}
    WHERE "RateLimitBucket"."resetAt" <= ${now} OR "RateLimitBucket"."count" < ${limit}
    RETURNING "count"`;
  return rows.length === 0;
}