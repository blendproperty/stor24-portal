import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { updateTaskSchema } from "@/lib/validators";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organisationId, user } = await requirePermission("operations.manage");
    const { id } = await params;
    const input = updateTaskSchema.parse(await request.json());
    const before = await db.task.findFirst({ where: { id, organisationId } });
    if (!before) return Response.json({ error: { code: "NOT_FOUND", message: "Task not found." } }, { status: 404 });
    if (before.facilityId) await requirePermission("operations.manage", before.facilityId);
    if (before.purpose === "AGREED_FOLLOWUP") return Response.json({ error: { code: "CONFLICT", message: "Open Follow-ups & handovers to update this appointment using its current version." } }, { status: 409 });
    const task = await db.$transaction(async tx => {
      const updated = await tx.task.update({ where: { id }, data: { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null } });
      await tx.auditEvent.create({ data: { organisationId, actorId: user.id, action: "task.status.change", entityType: "task", entityId: id, before, after: updated } });
      return updated;
    });
    return Response.json({ data: task });
  } catch (error) { return authErrorResponse(error); }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requirePermission("operations.view"), { id } = await params;
    const unrestricted = scope.allowedFacilityIds === null;
    const facilities = { organisationId: scope.organisationId, ...(unrestricted ? {} : { id: { in: scope.allowedFacilityIds ?? [] } }) };
    const task = await db.task.findFirst({ where: { id, organisationId: scope.organisationId, ...(unrestricted ? { OR: [{ facilityId: null }, { facility: facilities }] } : { facility: facilities }) }, select: { id: true, status: true } });
    if (!task) return Response.json({ error: { message: "Task is not available in your current store access." } }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return Response.json({ data: task }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
