import { updateArrearsReviewTaskStatus } from "@/lib/arrears-review-task-service";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { updateTaskSchema } from "@/lib/validators";
import { scheduledWorkPurposes, scheduledWorkSchema } from "@/lib/scheduled-work-policy";
import { changeScheduledWork } from "@/lib/scheduled-work-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organisationId, user, allowedFacilityIds } = await requirePermission("operations.manage");
    const { id } = await params;
    const input = updateTaskSchema.parse(await request.json());
    const before = await db.task.findFirst({ where: { id, organisationId } });
    if (!before) return Response.json({ error: { code: "NOT_FOUND", message: "Task not found." } }, { status: 404 });
    if (!before.facilityId && allowedFacilityIds !== null) throw new Error("FORBIDDEN");
    if (before.facilityId) await requirePermission("operations.manage", before.facilityId);
    if (before.purpose === "OPERATIONAL_CHECKLIST") return Response.json({ error: { code: "CONFLICT", message: "Open Checklists & padlocks to record results and obtain manager review." } }, { status: 409 });
    if (before.purpose === "AGREED_FOLLOWUP") return Response.json({ error: { code: "CONFLICT", message: "Open Follow-ups & handovers to update this appointment using its current version." } }, { status: 409 });
    if (scheduledWorkPurposes.some(purpose => purpose === before.purpose)) {
      const details = scheduledWorkSchema.parse({ ...Object.fromEntries(["facilityId", "unitId", "assigneeId", "purpose", "title", "description"].map(key => [key, before[key as keyof typeof before]])), description: before.description ?? "", startAt: before.startAt?.toISOString(), endAt: before.endAt?.toISOString() });
      const task = await changeScheduledWork({ organisationId, userId: user.id, facilityIds: allowedFacilityIds ?? [], unrestrictedFacilities: allowedFacilityIds === null }, id, before.updatedAt.toISOString(), details, input.status);
      return Response.json({ data: task });
    }
    if (before.purpose === "ARREARS_ESCALATION_REVIEW") {
      const task = await db.$transaction(tx => updateArrearsReviewTaskStatus(tx, { organisationId, userId: user.id, facilityIds: allowedFacilityIds ?? [], unrestrictedFacilities: allowedFacilityIds === null }, id, input.status));
      return Response.json({ data: task });
    }
    const task = await db.$transaction(async tx => {
      const current = await tx.task.findFirst({ where: { id, organisationId, ...(allowedFacilityIds === null ? {} : { facilityId: { in: allowedFacilityIds } }) } });
      if (!current) throw new Error("FORBIDDEN");
      const updated = await tx.task.update({ where: { id }, data: { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null } });
      await tx.auditEvent.create({ data: { organisationId, actorId: user.id, action: "task.status.change", entityType: "task", entityId: id, before, after: updated } });
      return updated;
    });
    return Response.json({ data: task });
  } catch (error) {
    if (error instanceof Error && ["SCHEDULE_CLOSED", "CONFLICT"].includes(error.message)) return Response.json({ error: { code: "CONFLICT", message: "The occurrence is closed or changed. Review it in Calendar before acting." } }, { status: 409 });
    if (error instanceof Error && error.message === "ARREARS_REVIEW_TASK_CLOSED") return Response.json({ error: { code: "CONFLICT", message: "This closed review task cannot be reopened. Create a new review request in Collections." } }, { status: 409 });
    if (error instanceof Error && error.message === "ARREARS_REVIEW_TASK_NOT_FOUND") return Response.json({ error: { code: "NOT_FOUND", message: "Review task is outside your current store access." } }, { status: 404 });
    return authErrorResponse(error);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requirePermission("operations.view"), { id } = await params;
    const unrestricted = scope.allowedFacilityIds === null;
    const facilities = { organisationId: scope.organisationId, ...(unrestricted ? {} : { id: { in: scope.allowedFacilityIds ?? [] } }) };
    const task = await db.task.findFirst({ where: { id, organisationId: scope.organisationId, ...(unrestricted ? { OR: [{ facilityId: null }, { facility: facilities }] } : { facility: facilities }) }, select: { id: true, status: true } });
    if (!task) return Response.json({ error: { message: "Task is not available in your current store access." } }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return Response.json({ data: task }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { const response = authErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
