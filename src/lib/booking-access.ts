import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newIdentityAccess() {
  const token = randomBytes(32).toString("base64url");
  return { token, identityAccessHash: createHash("sha256").update(token).digest("hex"), identityAccessExpiresAt: new Date(Date.now() + 60 * 60 * 1000) };
}
export function identityAccessMatches(token: string, hash: string | null, expiresAt: Date | null) {
  return /^[A-Za-z0-9_-]{43}$/.test(token) && Boolean(hash && /^[a-f0-9]{64}$/.test(hash) && expiresAt && expiresAt > new Date() && timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(hash, "hex")));
}
export function reservationAccessMatches(token: string, booking: { identityAccessHash: string | null; identityAccessExpiresAt: Date | null; publicLease?: { signingToken: string; status: string; expiresAt: Date } | null }) {
  if (identityAccessMatches(token, booking.identityAccessHash, booking.identityAccessExpiresAt)) return true;
  const lease = booking.publicLease;
  return /^[A-Za-z0-9_-]{43}$/.test(token) && Boolean(lease && (lease.status === "SIGNED" || lease.expiresAt > new Date()) && timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(lease.signingToken).digest()));
}
