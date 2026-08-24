import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export const mfaChallengeCookieName = "stor24_mfa_challenge";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return new TextEncoder().encode(secret);
}

export async function setMfaChallenge(userId: string) {
  const token = await new SignJWT({ userId, purpose: "mfa-login" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setAudience("stor24-mfa").setExpirationTime("5m").sign(key());
  (await cookies()).set(mfaChallengeCookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", priority: "high", path: "/", maxAge: 300 });
}

export async function getMfaChallenge() {
  const token = (await cookies()).get(mfaChallengeCookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: "stor24-mfa" });
    return payload.purpose === "mfa-login" && typeof payload.userId === "string" ? payload.userId : null;
  } catch { return null; }
}

export async function clearMfaChallenge() { (await cookies()).delete(mfaChallengeCookieName); }
