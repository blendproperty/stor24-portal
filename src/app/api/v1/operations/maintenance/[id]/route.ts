import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { updateMaintenanceSchema } from "@/lib/validators";

const activeMaintenanceStatuses = ["OPEN", "SCHEDULED", "IN_PROGRESS", "BLOCKED"] as const;
const blockingOccupancyStatuses = ["PENDING", "ACTIVE", "TRANSFERRING", "NOTICE_GIVEN"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organisationId, user } = await requirePermission("operations.manage");
    const { id } = await params;
    const input = updateMaintenanceSchema.parse(await request.json());
    const before = await db.maintenanceRequest.findFirst({ where: { id, organisationId } });
    if (!before) return Response.json({ error: { code: "NOT_FOUND", message: "Maintenance request not found." } }, { status: 404 });
    await requirePermission("operations.manage", before.facilityId);

    const maintenance = await db.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id },
        data: { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null },
      });

      if (before.unitId && ["COMPLETED", "CANCELLED"].includes(input.status)) {
        const [otherMaintenance, activeReservations, blockingOccupancies] = await Promise.all([
          tx.maintenanceRequest.count({
            where: { id: { not: id }, unitId: before.unitId, status: { in: [...activeMaintenanceStatuses] } },
          }),
          tx.reservation.count({ where: { unitId: before.unitId, status: "ACTIVE" } }),
          tx.occupancy.count({ where: { unitId: before.unitId, status: { in: [...blockingOccupancyStatuses] } } }),
        ]);
        if (!otherMaintenance && !activeReservations && !blockingOccupancies) {
          await tx.unit.updateMany({ where: { id: before.unitId, status: "SERVICE" }, data: { status: "AVAILABLE" } });
        }
      }

      await tx.auditEvent.create({
        data: {
          organisationId,
          actorId: user.id,
          action: "maintenance.status.change",
          entityType: "maintenance",
          entityId: id,
          before,
          after: updated,
        },
      });
      return updated;
    });
    return Response.json({ data: maintenance });
  } catch (error) {
    return authErrorResponse(error);
  }
}
