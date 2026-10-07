import { currentRoleAccess } from "@/lib/current-role-access";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { updateUserSchema } from "@/lib/validators";
import { sameOrigin } from "@/lib/request-security";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("users.manage");
  if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
  const parsed = updateUserSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: { message: "Check the user changes." } }, { status: 422 });
  const owner = currentRoleAccess(actor.user.roleAssignments).owner;
  if (parsed.data.roleName && !owner) return Response.json({ error: { message: "Only a Super Admin (Organisation owner) may change security roles." } }, { status: 403 });
  const { id } = await context.params;
  const target = await db.user.findFirst({ where: { id, organisationId: actor.user.organisationId }, include: { roleAssignments: { include: { role: true } } } });
  if (!target) return Response.json({ error: { message: "User not found." } }, { status: 404 });
  if (!owner && currentRoleAccess(target.roleAssignments, "data.personal_export").allowed) return Response.json({ error: { message: "Only a Super Admin may change access for a personal-data export administrator." } }, { status: 403 });
  if (target.id === actor.user.id && parsed.data.active === false) return Response.json({ error: { message: "You cannot deactivate your own account." } }, { status: 409 });
  if (target.id === actor.user.id && parsed.data.roleName && parsed.data.roleName !== "Organisation owner") return Response.json({ error: { message: "You cannot remove your own owner role." } }, { status: 409 });
  const removesOwner = target.roleAssignments.some((assignment) => assignment.role.name === "Organisation owner") && (parsed.data.active === false || (parsed.data.roleName && parsed.data.roleName !== "Organisation owner"));
  if (removesOwner) {
    const ownerCount = await db.user.count({ where: { organisationId: target.organisationId, active: true, roleAssignments: { some: { role: { name: "Organisation owner" } } } } });
    if (ownerCount <= 1) return Response.json({ error: { message: "The final active organisation owner cannot be removed." } }, { status: 409 });
  }
  const role = parsed.data.roleName ? await db.role.findUnique({ where: { organisationId_name: { organisationId: target.organisationId, name: parsed.data.roleName } } }) : null;
  const facility = parsed.data.facilityCode ? await db.facility.findUnique({ where: { organisationId_code: { organisationId: target.organisationId, code: parsed.data.facilityCode } } }) : null;
  await db.$transaction(async (tx) => {
    if (parsed.data.active !== undefined) await tx.user.update({ where: { id }, data: { active: parsed.data.active, sessionVersion: { increment: 1 } } });
    if (role) { await tx.roleAssignment.deleteMany({ where: { userId: id } }); await tx.roleAssignment.create({ data: { userId: id, roleId: role.id, facilityId: facility?.id } }); await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } }); }
    await tx.auditEvent.create({ data: { organisationId: target.organisationId, actorId: actor.user.id, action: "user.access.updated", entityType: "User", entityId: id, before: { active: target.active }, after: parsed.data } });
  });
  return Response.json({ data: { updated: true } });
}
