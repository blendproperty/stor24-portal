import type { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "./scope";
import { currentRoleAccess } from "./current-role-access";

export async function arrearsAuthority(tx: Prisma.TransactionClient, scope: RequestScope, facilityId: string, permissions: string[], userId = scope.userId) {
  const user = await tx.user.findFirst({ where: { id: userId, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  const assignments = user?.roleAssignments.filter(a => a.role.organisationId === scope.organisationId) ?? [];
  if (!user || !permissions.every(p => currentRoleAccess(assignments, p, facilityId).allowed)) throw Error("FORBIDDEN");
  return user;
}
