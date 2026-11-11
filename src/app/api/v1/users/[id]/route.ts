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
  if (actor.allowedFacilityIds !== null && (!target.roleAssignments.length || target.roleAssignments.some(assignment => !assignment.facilityId || !actor.allowedFacilityIds!.includes(assignment.facilityId)))) return Response.json({ error: { message: "User is outside your permitted facilities." } }, { status: 403 });
  if (!owner && currentRoleAccess(target.roleAssignments, "data.personal_export").allowed) return Response.json({ error: { message: "Only a Super Admin may change access for a personal-data export administrator." } }, { status: 403 });
  if (target.id === actor.user.id && parsed.data.active === false) return Response.json({ error: { message: "You cannot deactivate your own account." } }, { status: 409 });
  if (target.id === actor.user.id && parsed.data.roleName && parsed.data.roleName !== "Organisation owner") return Response.json({ error: { message: "You cannot remove your own owner role." } }, { status: 409 });
  const removesOwner = target.roleAssignments.some((assignment) => assignment.role.name === "Organisation owner") && (parsed.data.active === false || (parsed.data.roleName && parsed.data.roleName !== "Organisation owner"));
  if (removesOwner) {
    const ownerCount = await db.user.count({ where: { organisationId: target.organisationId, active: true, roleAssignments: { some: { role: { name: "Organisation owner" } } } } });
    if (ownerCount <= 1) return Response.json({ error: { message: "The final active organisation owner cannot be removed." } }, { status: 409 });
  }
  const role = parsed.data.roleName ? await db.role.findUnique({ where: { organisationId_name: { organisationId: target.organisationId, name: parsed.data.roleName } } }) : null;
  if (parsed.data.roleName && !role) return Response.json({ error: { message: "Choose a valid security role." } }, { status: 422 });
  const facility = parsed.data.facilityCode ? await db.facility.findUnique({ where: { organisationId_code: { organisationId: target.organisationId, code: parsed.data.facilityCode } } }) : null;
  if (parsed.data.facilityCode && !facility) return Response.json({ error: { message: "Choose a valid facility." } }, { status: 422 });
  if (role && parsed.data.facilityCode === undefined && !target.roleAssignments.length) return Response.json({ error: { message: "Choose a facility for this user." } }, { status: 409 });
  if (role?.name === "Facility manager" && (parsed.data.facilityCode === null || parsed.data.facilityCode === "" || (parsed.data.facilityCode === undefined && target.roleAssignments.some(a => a.facilityId === null)))) return Response.json({ error: { message: "Choose a facility for a facility manager." } }, { status: 409 });
  await db.$transaction(async (tx) => {
    if (parsed.data.active !== undefined) {
      await tx.user.update({ where: { id }, data: { active: parsed.data.active, sessionVersion: { increment: 1 } } });
      if (!parsed.data.active) await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    }
    if (role) {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.roleAssignment.findMany({ where: { userId: id }, select: { facilityId: true } });
      const facilities = parsed.data.facilityCode === undefined ? [...new Set(existing.map(a => a.facilityId))] : [facility?.id ?? null];
      if (!facilities.length) throw new Error("USER_SCOPE_REQUIRED");
      if (role.name === "Facility manager" && facilities.some(id => id === null)) throw new Error("USER_SCOPE_REQUIRED");
      await tx.roleAssignment.deleteMany({ where: { userId: id } });
      for (const facilityId of facilities) await tx.roleAssignment.create({ data: { userId: id, roleId: role.id, facilityId } });
      await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    }
    await tx.auditEvent.create({ data: { organisationId: target.organisationId, actorId: actor.user.id, action: "user.access.updated", entityType: "User", entityId: id, before: { active: target.active }, after: parsed.data } });
  });
  return Response.json({ data: { updated: true } });
}
