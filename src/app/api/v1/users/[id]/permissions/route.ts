import { z } from "zod";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { securityPermissionKeys } from "@/lib/security-permissions";

const schema = z.object({ permissions: z.array(z.enum(securityPermissionKeys)).max(securityPermissionKeys.length) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
  const actor = await requireOwner();
  if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: { message: "Check the selected permissions." } }, { status: 422 });
  const { id } = await context.params;
  const target = await db.user.findFirst({ where: { id, organisationId: actor.user.organisationId }, include: { roleAssignments: { include: { role: true } } } });
  if (!target) return Response.json({ error: { message: "Employee not found." } }, { status: 404 });
  if (target.roleAssignments.some((assignment) => assignment.role.name === "Organisation owner")) return Response.json({ error: { message: "Owner permissions cannot be reduced. Assign another security level first." } }, { status: 409 });

  const currentAssignment = target.roleAssignments[0];
  const roleName = `Custom access · ${target.id}`;
  const uniquePermissions = [...new Set(parsed.data.permissions)].sort();
  await db.$transaction(async (tx) => {
    const role = await tx.role.upsert({
      where: { organisationId_name: { organisationId: target.organisationId, name: roleName } },
      update: { permissions: uniquePermissions },
      create: { organisationId: target.organisationId, name: roleName, permissions: uniquePermissions },
    });
    await tx.roleAssignment.deleteMany({ where: { userId: target.id } });
    await tx.roleAssignment.create({ data: { userId: target.id, roleId: role.id, facilityId: currentAssignment?.facilityId ?? null } });
    await tx.user.update({ where: { id: target.id }, data: { sessionVersion: { increment: 1 } } });
    await tx.auditEvent.create({ data: {
      organisationId: target.organisationId, actorId: actor.user.id, action: "user.permissions.updated", entityType: "User", entityId: target.id,
      before: { role: currentAssignment?.role.name ?? "Unassigned", permissions: currentAssignment?.role.permissions ?? [] }, after: { role: roleName, permissions: uniquePermissions },
    } });
  });
  return Response.json({ data: { role: roleName, permissions: uniquePermissions } });
  } catch (error) { return authErrorResponse(error); }
}
