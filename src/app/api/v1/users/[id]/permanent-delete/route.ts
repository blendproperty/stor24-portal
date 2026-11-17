import { currentRoleAccess } from "@/lib/current-role-access";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth-guards";
import { userRemovalDependencies } from "@/lib/staff-user-removal";
import { sameOrigin } from "@/lib/request-security";
import { canRetainTaskData } from "@/lib/staff-retained-task-data";

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
      const actorLock = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${actor.user.id} FOR UPDATE SKIP LOCKED`;
      if (!actorLock.length) return { kind: "busy" as const };
      const current = await tx.user.findUnique({ where: { id: actor.user.id }, include: { roleAssignments: { include: { role: true } } } });
      if (!current?.active || !current.passwordHash || current.sessionVersion !== actor.user.sessionVersion || !currentRoleAccess(current.roleAssignments).owner) throw new Error("FORBIDDEN");
      const targetLock = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${id} AND "organisationId" = ${actor.user.organisationId} FOR UPDATE SKIP LOCKED`;
      const target = await tx.user.findFirst({ where: { id, organisationId: actor.user.organisationId } });
      if (!target) return { kind: "missing" as const };
      if (!targetLock.length) return { kind: "busy" as const };
      if (target.retiredAt) return { kind: "missing" as const };
      if (target.active) return { kind: "active" as const };
      const dependencies = await userRemovalDependencies(tx, id);
      const retainedTypes = ["Business audit event", "Lead", "ReservationPriceAmendment", "Task", "MoveInTrainingRun", "PriceApprovalChallenge"];
      const unsupported = dependencies.filter(type => !retainedTypes.includes(type) && type !== "Task data");
      if (dependencies.includes("Task data")) {
        const records = await tx.$queryRaw<{ organisationId: string; purpose: string; status: string; operationalForm: unknown; operationalChecklist: unknown }[]>`SELECT "organisationId", "purpose", "status", "operationalForm", "operationalChecklist" FROM "Task" WHERE position(${id} in "operationalForm"::text) > 0 OR position(${id} in "operationalChecklist"::text) > 0 LIMIT 501`;
        if (records.length > 500 || records.some(record => record.organisationId !== target.organisationId || !canRetainTaskData(record, id))) unsupported.push("Task data");
      }
      if (unsupported.length) return { kind: "linked" as const, dependencies: unsupported };
      const foreign = await Promise.all([
        tx.auditEvent.count({ where: { actorId: id, organisationId: { not: target.organisationId } } }),
        tx.lead.count({ where: { assignedToId: id, facility: { organisationId: { not: target.organisationId } } } }),
        tx.task.count({ where: { organisationId: { not: target.organisationId }, OR: [{ assigneeId: id }, { coverId: id }, { createdById: id }] } }),
        tx.reservationPriceAmendment.count({ where: { organisationId: { not: target.organisationId }, OR: [{ proposedById: id }, { reviewedById: id }] } }),
        tx.moveInTrainingRun.count({ where: { organisationId: { not: target.organisationId }, userId: id } }),
        tx.priceApprovalChallenge.count({ where: { organisationId: { not: target.organisationId }, OR: [{ requestedById: id }, { approverId: id }] } }),
      ]);
      if (foreign.some(count => count > 0)) return { kind: "linked" as const, dependencies: ["records requiring administrative review"] };
      const outstanding = await tx.task.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] }, OR: [{ assigneeId: id }, { coverId: id }, { purpose: "OPERATIONAL_FORM", assigneeId: null, createdById: id }] } });
      if (outstanding) return { kind: "linked" as const, dependencies: ["outstanding tasks"] };
      if (await tx.lead.count({ where: { assignedToId: id, stage: { not: "LOST" } } })) return { kind: "linked" as const, dependencies: ["outstanding enquiries"] };
      await tx.auditEvent.updateMany({ where: { actorId: id }, data: { deletedActorId: id, deletedActorName: target.name, deletedActorEmail: target.email } });
      await tx.staffDeletionFence.update({ where: { id: 1 }, data: { generation: { increment: 1 } } });
      await tx.userInvitation.updateMany({ where: { organisationId: target.organisationId, email: target.email, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
      if (dependencies.length) {
        await tx.priceApprovalChallenge.updateMany({ where: { organisationId: target.organisationId, OR: [{ requestedById: id }, { approverId: id }], status: { in: ["SENDING", "SENT", "REVIEW_REQUIRED"] } }, data: { status: "CANCELLED" } });
        await tx.mfaCredential.deleteMany({ where: { userId: id } });
        await tx.passwordResetToken.deleteMany({ where: { userId: id } });
        await tx.roleAssignment.deleteMany({ where: { userId: id } });
        await tx.user.update({ where: { id }, data: { email: `retired+${id}@identity.invalid`, active: false, passwordHash: null, sessionVersion: { increment: 1 }, retiredAt: new Date() } });
      } else {
        await tx.user.delete({ where: { id } });
      }
      await tx.auditEvent.create({ data: { organisationId: target.organisationId, actorId: actor.user.id, action: "user.account.deleted", entityType: "User", entityId: id, after: { identityRetained: dependencies.length > 0 } } });
      await tx.deletedStaffIdentity.create({ data: { id, retained: dependencies.length > 0 } });
      return { kind: "deleted" as const };
    }, { isolationLevel: "ReadCommitted", timeout: 6000 });
    if (result.kind === "busy") return Response.json({ error: { message: "The system is processing another change. Please try deleting this user again shortly." } }, { status: 409 });
    if (result.kind === "missing") return Response.json({ error: { message: "User not found." } }, { status: 404 });
    if (result.kind === "active") return Response.json({ error: { message: "Deactivate this user first, then select Show inactive users to delete the account." } }, { status: 409 });
    if (result.kind === "linked") return Response.json({ error: { message: `This account needs further review before deletion (${result.dependencies.map(name => name.replace(/([a-z])([A-Z])/g, "$1 $2")).join(", ")}). Transfer outstanding work and review the remaining linked records.` } }, { status: 409 });
    return Response.json({ data: { deleted: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2003" || error.code === "P2014" || error.code === "P2034")) return Response.json({ error: { message: "The account is linked to records or changed during deletion. Refresh and review its linked records." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
