import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { currentRoleAccess } from "@/lib/current-role-access";
import { ZodError } from "zod";

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  const user = await db.user.findUnique({ where: { id: session.userId }, include: { roleAssignments: { include: { role: true, facility: true } } } });
  if (!user?.active || user.sessionVersion !== session.sessionVersion) throw new Error("UNAUTHENTICATED");
  const current = currentRoleAccess(user.roleAssignments);
  return { ...session, role: current.owner ? "Organisation owner" : user.roleAssignments[0]?.role.name ?? "", user, permissions: user.roleAssignments.flatMap((assignment) => assignment.role.permissions) };
}

export async function requireOwner() {
  const session = await requireSession();
  if (!currentRoleAccess(session.user.roleAssignments).owner) throw new Error("FORBIDDEN");
  return session;
}

export async function requirePermission(permission: string, facilityId?: string) {
  const auth = await requireSession();
  const user = auth.user;

  const access = currentRoleAccess(user.roleAssignments, permission, facilityId);
  if (!access.allowed) throw new Error("FORBIDDEN");
  return { ...auth, organisationId: user.organisationId, allowedFacilityIds: access.allowedFacilityIds };
}

export function authErrorResponse(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error: { code: "VALIDATION_ERROR", message: "The submitted data is invalid.", fields: error.flatten().fieldErrors } }, { status: 422 });
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHENTICATED") return Response.json({ error: { code: message, message: "Sign in is required." } }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: { code: message, message: "You do not have permission for this action." } }, { status: 403 });
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, { status: 500 });
}
