import { z } from "zod";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";
import { sameOrigin } from "@/lib/request-security";
import { changeOperationalChecklist } from "@/lib/operational-checklist-service";
import { checklistRecordSchema } from "@/lib/operational-checklist-policy";

const transfer = z.object({ taskId: z.string().cuid(), replacementId: z.string().cuid(), updatedAt: z.iso.datetime() }).strict();
const supported = ["GENERAL", "AGREED_FOLLOWUP"];

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireOwner();
    const { id } = await context.params;
    const target = await db.user.findFirst({ where: { id, organisationId: actor.user.organisationId }, select: { id: true } });
    if (!target) return Response.json({ error: { message: "User not found." } }, { status: 404 });
    const tasks = await db.task.findMany({
      where: { organisationId: actor.user.organisationId, status: { notIn: ["COMPLETED", "CANCELLED"] }, OR: [{ assigneeId: id }, { coverId: id }, { purpose: "OPERATIONAL_CHECKLIST", operationalChecklist: { path: ["reviewerId"], equals: id } }] },
      select: { id: true, title: true, purpose: true, status: true, updatedAt: true, facilityId: true, facility: { select: { name: true } }, assigneeId: true, coverId: true, operationalChecklist: true },
      orderBy: { id: "asc" }, take: 201,
    });
    return Response.json({ data: tasks.slice(0, 200).map(({ operationalChecklist, ...task }) => ({ ...task, reviewerId: task.purpose === "OPERATIONAL_CHECKLIST" ? checklistRecordSchema.safeParse(operationalChecklist).data?.reviewerId ?? null : null })), truncated: tasks.length > 200 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const actor = await requireOwner();
    const input = transfer.parse(await request.json());
    const { id } = await context.params;
    if (id === input.replacementId) return Response.json({ error: { message: "Choose another user." } }, { status: 422 });
    const checklist = await db.task.findFirst({ where: { id: input.taskId, organisationId: actor.user.organisationId, purpose: "OPERATIONAL_CHECKLIST" } });
    if (checklist) {
      if (!await db.user.findFirst({ where: { id, organisationId: actor.user.organisationId }, select: { id: true } })) return Response.json({ error: { message: "User not found." } }, { status: 404 });
      const record = checklistRecordSchema.safeParse(checklist.operationalChecklist);
      if (!record.success || !checklist.assigneeId || checklist.updatedAt.toISOString() !== input.updatedAt || (checklist.assigneeId !== id && checklist.coverId !== id && record.data.reviewerId !== id)) return Response.json({ error: { message: "The checklist changed. Refresh the review and try again." } }, { status: 409 });
      await changeOperationalChecklist({ userId: actor.user.id, organisationId: actor.user.organisationId, facilityIds: [], unrestrictedFacilities: true }, { id: checklist.id, action: "ASSIGN", expectedUpdatedAt: input.updatedAt, assigneeId: checklist.assigneeId === id ? input.replacementId : checklist.assigneeId, coverId: checklist.coverId === id ? input.replacementId : checklist.coverId, reviewerId: record.data.reviewerId === id ? input.replacementId : record.data.reviewerId });
      return Response.json({ data: { reassigned: true } }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await db.$transaction(async tx => {
      const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(143, 2441) AS acquired`;
      if (!acquired) return "busy";
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "organisationId" = ${actor.user.organisationId} AND "id" IN (${actor.user.id}, ${id}, ${input.replacementId}) ORDER BY "id" FOR UPDATE`;
      const current = await tx.user.findFirst({ where: { id: actor.user.id, organisationId: actor.user.organisationId }, include: { roleAssignments: { include: { role: true } } } });
      if (!current?.active || !current.passwordHash || current.sessionVersion !== actor.user.sessionVersion || !currentRoleAccess(current.roleAssignments).owner) throw new Error("FORBIDDEN");
      const target = await tx.user.findFirst({ where: { id, organisationId: current.organisationId } });
      const replacement = await tx.user.findFirst({ where: { id: input.replacementId, organisationId: current.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
      if (!target || !replacement || !replacement.passwordHash) return "user";
      const task = await tx.task.findFirst({ where: { id: input.taskId, organisationId: current.organisationId } });
      if (!task || !supported.includes(task.purpose) || ["COMPLETED", "CANCELLED"].includes(task.status) || (task.assigneeId !== id && task.coverId !== id) || task.updatedAt.toISOString() !== input.updatedAt) return "changed";
      const access = currentRoleAccess(replacement.roleAssignments.filter(a => a.role.organisationId === current.organisationId), "operations.view", task.facilityId ?? undefined);
      if (!access.allowed || (!task.facilityId && access.allowedFacilityIds !== null)) return "access";
      const assigneeId = task.assigneeId === id ? replacement.id : task.assigneeId;
      const coverId = task.coverId === id ? replacement.id : task.coverId;
      if (assigneeId && assigneeId === coverId) return "duplicate";
      const changed = await tx.task.updateMany({ where: { id: task.id, updatedAt: task.updatedAt, status: task.status, assigneeId: task.assigneeId, coverId: task.coverId }, data: { assigneeId, coverId, coverAcknowledgedAt: null, updatedAt: new Date(Math.max(Date.now(), task.updatedAt.getTime() + 1)) } });
      if (changed.count !== 1) return "changed";
      await tx.auditEvent.create({ data: { organisationId: current.organisationId, facilityId: task.facilityId, actorId: current.id, action: "staff.task_reassigned", entityType: "Task", entityId: task.id, before: { assigneeId: task.assigneeId, coverId: task.coverId }, after: { assigneeId, coverId } } });
      return "ok";
    }, { isolationLevel: "Serializable", timeout: 10000 });
    if (result !== "ok") return Response.json({ error: { message: result === "access" ? "The replacement cannot view work at this facility." : result === "duplicate" ? "The same person cannot be both assignee and cover." : result === "busy" ? "Another change is in progress. Try again shortly." : "The user or task changed. Refresh the review and try again." } }, { status: 409 });
    return Response.json({ data: { reassigned: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && ["CONFLICT", "CHECKLIST_REVIEWER_REQUIRED", "CHECKLIST_PADLOCK_REVIEWER_REQUIRED", "NOT_FOUND"].includes(error.message)) return Response.json({ error: { message: "The checklist changed or the replacement does not meet its independent-review requirements. Refresh and choose an eligible person." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
