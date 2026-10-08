import { createHash, randomBytes } from "node:crypto";

export const WALK_IN_LAUNCH_MS = 5 * 60 * 1000;
export const WALK_IN_VISIT_MS = 60 * 60 * 1000;
export function walkInToken() { return randomBytes(32).toString("hex"); }
export function walkInTokenHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("WALK_IN_UNAVAILABLE");
  return createHash("sha256").update(token).digest("hex");
}
export function walkInUsable(visit: { status: string; expiresAt: Date; facility: { active: boolean; publicBookingEnabled: boolean }; createdBy: { active: boolean } } | null, now = new Date()) {
  return Boolean(visit && ["READY", "IN_PROGRESS"].includes(visit.status) && visit.expiresAt > now && visit.facility.active && visit.facility.publicBookingEnabled && visit.createdBy.active);
}
