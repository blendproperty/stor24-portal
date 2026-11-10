import { currentRoleAccess } from "@/lib/current-role-access";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth-guards";
import { userRemovalDependencies } from "@/lib/staff-user-removal";
import { sameOrigin } from "@/lib/request-security";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const actor = await requireOwner();
    const { id } = await context.params;
    if (id === actor.user.id) return Response.json({ error: { message: "You cannot delete your own account." } }, { status: 409 });
    if (!/^c[a-z0-9]{24}$/.test(id)) return Response.json({ error: { message: "This account requires administrator review before deletion." } }, { status: 409 });
    const result = await db.$transaction(async tx => {
      const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(143, 2441) AS acquired`;
      if (!acquired) return { kind: "busy" as const };
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: actor.user.id }, include: { roleAssignments: { include: { role: true } } } });
      if (!current?.active || !current.passwordHash || current.sessionVersion !== actor.user.sessionVersion || !currentRoleAccess(current.roleAssignments).owner) throw new Error("FORBIDDEN");
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} AND "organisationId" = ${actor.user.organisationId} FOR UPDATE`;
      const target = await tx.user.findFirst({ where: { id, organisationId: actor.user.organisationId } });
      if (!target) return { kind: "missing" as const };
      if (target.active) return { kind: "active" as const };
      const dependencies = await userRemovalDependencies(tx, id);
      if (dependencies.length) return { kind: "linked" as const, dependencies };
      await tx.staffDeletionFence.update({ where: { id: 1 }, data: { generation: { increment: 1 } } });
      await tx.deletedStaffIdentity.create({ data: { id } });
      await tx.userInvitation.updateMany({ where: { organisationId: target.organisationId, email: target.email, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
      await tx.user.delete({ where: { id } });
      await tx.auditEvent.create({ data: { organisationId: target.organisationId, actorId: actor.user.id, action: "user.account.deleted", entityType: "User", entityId: id } });
      return { kind: "deleted" as const };
    }, { isolationLevel: "ReadCommitted", timeout: 6000 });
    if (result.kind === "busy") return Response.json({ error: { message: "The system is processing another change. Please try deleting this user again shortly." } }, { status: 409 });
    if (result.kind === "missing") return Response.json({ error: { message: "User not found." } }, { status: 404 });
    if (result.kind === "active") return Response.json({ error: { message: "Deactivate this user first, then select Show inactive users to delete the account." } }, { status: 409 });
    if (result.kind === "linked") return Response.json({ error: { message: `This user is linked to business records (${result.dependencies.map(name => name.replace(/([a-z])([A-Z])/g, "$1 $2")).join(", ")}). Reassign those records before deleting the user.` } }, { status: 409 });
    return Response.json({ data: { deleted: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2003" || error.code === "P2014" || error.code === "P2034")) return Response.json({ error: { message: "The account is linked to records or changed during deletion. Refresh and review its linked records." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
