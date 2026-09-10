import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

export const TENANT_SESSION_COOKIE = "stor24_tenant_session";
export const TENANT_CHALLENGE_COOKIE = "stor24_tenant_challenge";
export const TENANT_SESSION_MS = 30 * 60 * 1000;
export const TENANT_CODE_MS = 10 * 60 * 1000;
export const tenantToken = () => randomBytes(32).toString("hex");
export const tenantTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const tenantCode = () => randomInt(0, 1000000).toString().padStart(6, "0");
export function tenantCodeHash(challengeId: string, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("TENANT_AUTH_UNCONFIGURED");
  return createHmac("sha256", secret).update(`tenant-otp:${challengeId}:${code}`).digest("hex");
}
export function tenantCustomerScope(session: { organisationId: string; email: string; customerIds: string[] }) {
  return { organisationId: session.organisationId, id: { in: session.customerIds }, email: { equals: session.email, mode: "insensitive" as const }, emailVerifiedAt: { not: null } };
}
