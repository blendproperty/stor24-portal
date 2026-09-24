import { db } from "@/lib/db";
import { requirePermission, requireSession } from "@/lib/auth-guards";

export type RequestScope = {
  userId: string;
  organisationId: string;
  facilityIds: string[];
  unrestrictedFacilities: boolean;
};

export async function requireScope(): Promise<RequestScope> {
  const session = await requireSession();
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { roleAssignments: { include: { role: true } } },
  });
  if (!user?.active) throw new Error("UNAUTHENTICATED");
  const assignments = user.roleAssignments;
  if (!assignments.length) throw new Error("FORBIDDEN");
  return {
    userId: user.id,
    organisationId: user.organisationId,
    facilityIds: assignments.flatMap((assignment) => assignment.facilityId ? [assignment.facilityId] : []),
    unrestrictedFacilities: assignments.some((assignment) => !assignment.facilityId),
  };
}

export async function requirePermissionScope(permission: string, facilityId?: string): Promise<RequestScope> {
  const auth = await requirePermission(permission, facilityId);
  return {
    userId: auth.user.id,
    organisationId: auth.organisationId,
    facilityIds: auth.allowedFacilityIds ?? [],
    unrestrictedFacilities: auth.allowedFacilityIds === null,
  };
}

export function facilityWhere(scope: RequestScope) {
  return {
    organisationId: scope.organisationId,
    ...(scope.unrestrictedFacilities ? {} : { id: { in: scope.facilityIds } }),
  };
}

export async function requireFacility(scope: RequestScope, facilityId: string) {
  const facility = await db.facility.findFirst({ where: { AND: [{ id: facilityId }, facilityWhere(scope)] } });
  if (!facility) throw new Error("FACILITY_FORBIDDEN");
  return facility;
}
