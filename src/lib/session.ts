import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const sessionCookieName = "stor24_session";

export type SessionPayload = JWTPayload & {
  userId: string;
  name: string;
  email: string;
  role: string;
  sessionVersion: number;
  mfaVerified?: boolean;
};

function sessionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: Omit<SessionPayload, keyof JWTPayload>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(sessionKey());
}

export async function verifySessionToken(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    if (!payload.userId || !payload.email || !payload.name || !payload.role || !Number.isInteger(payload.sessionVersion)) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession() {
  return verifySessionToken((await cookies()).get(sessionCookieName)?.value);
}

export async function setSession(payload: Omit<SessionPayload, keyof JWTPayload>) {
  const token = await createSessionToken(payload);
  (await cookies()).set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    priority: "high",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSession() {
  (await cookies()).delete(sessionCookieName);
}
