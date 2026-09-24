import { hasPermission } from "./permissions";
type Assignment = { facilityId: string | null; role: { name: string; permissions: string[] } };

/** Privilege derives from current database assignments, never a role cached in a cookie. */
export function currentRoleAccess(assignments: Assignment[], permission?: string, facilityId?: string) {
  const owner = assignments.some(a => a.facilityId === null && a.role.name === "Organisation owner");
  const matching = permission ? assignments.filter(a =>
    (!facilityId || !a.facilityId || a.facilityId === facilityId) &&
    hasPermission(a.role.permissions, permission)) : [];
  return { owner, allowed: owner || matching.length > 0,
    allowedFacilityIds: owner || matching.some(a => a.facilityId === null) ? null : matching.map(a => a.facilityId!).filter(Boolean) };
}
