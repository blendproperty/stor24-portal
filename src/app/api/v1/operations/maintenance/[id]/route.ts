import { authErrorResponse, requirePermission, requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { maintenanceJobActionAllowed, midpointMaintenanceRole, MIDPOINT_JOB_CARD_ROLE, validMidpointJobCardRole } from "@/lib/maintenance-job-policy";
import { sameOrigin } from "@/lib/request-security";
import { maintenanceJobActionSchema, updateMaintenanceSchema } from "@/lib/validators";

const activeMaintenanceStatuses = ["OPEN", "SCHEDULED", "IN_PROGRESS", "BLOCKED"] as const;
const blockingOccupancyStatuses = ["PENDING", "ACTIVE", "TRANSFERRING", "NOTICE_GIVEN"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession();
    const { organisationId } = user;
    const { id } = await params;
    const body: unknown = await request.json();
    const role = midpointMaintenanceRole(user.email);
    const assigned = user.roleAssignments.filter(assignment => assignment.role.name === MIDPOINT_JOB_CARD_ROLE);
    const managerFacility = assigned.length === 1 &&
      validMidpointJobCardRole(user.email, assigned[0].role.permissions, assigned[0].facility) ? assigned[0].facilityId : null;
    if (assigned.length && !managerFacility) throw new Error("FORBIDDEN");
    if (!managerFacility) await requirePermission("operations.manage");
    const before = await db.maintenanceRequest.findFirst({
      where: { id, organisationId, ...(managerFacility ? { facilityId: managerFacility, jobCard: true } : {}) },
    });
    if (!before) return Response.json({ error: { code: "NOT_FOUND", message: "Maintenance request not found." } }, { status: 404 });
    if (!managerFacility) await requirePermission("operations.manage", before.facilityId);
    if (before.jobCard && role === "manager" && !managerFacility) throw new Error("FORBIDDEN");

    let action = "maintenance.status.change";
    let expectedVersion: Date | undefined;
    let data: Prisma.MaintenanceRequestUncheckedUpdateManyInput;
    if (before.jobCard) {
      if (!sameOrigin(request)) throw new Error("FORBIDDEN");
      const input = maintenanceJobActionSchema.parse(body);
      if (!maintenanceJobActionAllowed(role, before.status, !!before.repairReportedAt, input.action)) throw new Error("FORBIDDEN");
      expectedVersion = new Date(input.updatedAt);
      action = `maintenance.job_card.${input.action}`;
      switch (input.action) {
        case "manage":
          data = {
            assignedToId: user.id, status: input.status, contractor: input.contractor || null,
            scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
            progressNotes: input.progressNotes || null,
          };
          break;
        case "report":
          data = {
            assignedToId: user.id, status: "IN_PROGRESS", repairReportedAt: new Date(),
            completionEvidence: input.evidence, verificationNote: null,
          };
          break;
        case "verify":
          data = { status: "COMPLETED", completedAt: new Date(), verificationNote: input.note };
          break;
        case "cancel":
          data = { status: "CANCELLED", verificationNote: input.note };
          break;
        case "return":
          data = { repairReportedAt: null, verificationNote: input.note };
          break;
      }
    } else {
      const input = updateMaintenanceSchema.parse(body);
      data = { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null };
    }

    const maintenance = await db.$transaction(async (tx) => {
      if (before.unitId) await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id" = ${before.unitId} FOR UPDATE`;
      if (expectedVersion) {
        // Prisma stores timestamps at millisecond precision. Always advance the version.
        data.updatedAt = new Date(Math.max(Date.now(), expectedVersion.getTime() + 1));
        const claimed = await tx.maintenanceRequest.updateMany({
          where: { id, organisationId, updatedAt: expectedVersion, status: before.status, repairReportedAt: before.repairReportedAt },
          data,
        });
        if (claimed.count !== 1) return null;
      }
      const updated = expectedVersion
        ? await tx.maintenanceRequest.findUniqueOrThrow({ where: { id } })
        : await tx.maintenanceRequest.update({ where: { id }, data });

      if (before.unitId && ["COMPLETED", "CANCELLED"].includes(updated.status)) {
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
          action,
          entityType: "maintenance",
          entityId: id,
          before,
          after: updated,
        },
      });
      return updated;
    });
    if (!maintenance) return Response.json({ error: { code: "STALE_JOB_CARD", message: "This job card changed. Reload the queue before trying again." } }, { status: 409 });
    return Response.json({ data: maintenance });
  } catch (error) {
    return authErrorResponse(error);
  }
}
