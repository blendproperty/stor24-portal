import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/request-security";

const inputSchema = z.object({
  facilityId: z.string().min(1),
  unitId: z.string().min(1).optional(),
});

const blockingOccupancyStatuses = ["PENDING", "ACTIVE", "NOTICE_GIVEN"] as const;

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return Response.json({ error: { message: "Request rejected." } }, { status: 403 });

    const parsed = inputSchema.safeParse(await jsonBody(request));
    if (!parsed.success)
      return Response.json(
        { error: { code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors } },
        { status: 422 },
      );

    const auth = await requirePermission("inventory.manage", parsed.data.facilityId);
    const facility = await db.facility.findFirst({
      where: { id: parsed.data.facilityId, organisationId: auth.organisationId },
      select: { id: true, name: true },
    });
    if (!facility) throw new Error("NOT_FOUND");

    const result = await db.$transaction(async (tx) => {
      const candidates = await tx.unit.findMany({
        where: {
          facilityId: facility.id,
          status: "RESERVED",
          ...(parsed.data.unitId ? { id: parsed.data.unitId } : {}),
        },
        select: {
          id: true,
          number: true,
          reservations: { where: { status: "ACTIVE" }, select: { id: true } },
          occupancies: {
            where: { status: { in: [...blockingOccupancyStatuses] } },
            select: { id: true, status: true, tenancy: { select: { id: true, status: true } } },
          },
        },
        orderBy: { number: "asc" },
      });

      const released: string[] = [];
      const blocked: Array<{ unit: string; reasons: string[] }> = [];

      for (const unit of candidates) {
        const reasons: string[] = [];
        if (unit.reservations.length) reasons.push(`${unit.reservations.length} active reservation${unit.reservations.length === 1 ? "" : "s"}`);
        if (unit.occupancies.length) reasons.push(`${unit.occupancies.length} pending or active occupancy record${unit.occupancies.length === 1 ? "" : "s"}`);
        if (reasons.length) {
          blocked.push({ unit: unit.number, reasons });
          continue;
        }

        const changed = await tx.unit.updateMany({
          where: { id: unit.id, facilityId: facility.id, status: "RESERVED" },
          data: { status: "AVAILABLE" },
        });
        if (!changed.count) continue;
        released.push(unit.number);
        await tx.auditEvent.create({
          data: {
            organisationId: auth.organisationId,
            facilityId: facility.id,
            actorId: auth.user.id,
            action: "unit.orphaned_reservation_released",
            entityType: "Unit",
            entityId: unit.id,
            before: { status: "RESERVED" },
            after: { status: "AVAILABLE", reason: "No active reservation or occupancy" },
          },
        });
      }

      return { checked: candidates.length, released, blocked };
    });

    return Response.json({ data: { facilityId: facility.id, facilityName: facility.name, ...result } });
  } catch (error) {
    return apiError(error);
  }
}
