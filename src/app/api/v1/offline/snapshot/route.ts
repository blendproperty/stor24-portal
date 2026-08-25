import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";

const SNAPSHOT_HOURS = 12;

export async function GET(request: Request) {
  try {
    const facilityId = new URL(request.url).searchParams.get("facilityId")?.trim();
    if (!facilityId) {
      const auth = await requirePermission("operations.view");
      const facilities = await db.facility.findMany({
        where: { organisationId: auth.organisationId, active: true, ...(auth.allowedFacilityIds ? { id: { in: auth.allowedFacilityIds } } : {}) },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      });
      return Response.json({ data: { facilities } }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
    }

    const auth = await requirePermission("operations.view", facilityId);
    const facility = await db.facility.findFirst({
      where: { id: facilityId, organisationId: auth.organisationId, active: true },
      select: { id: true, name: true, code: true, timezone: true, updatedAt: true },
    });
    if (!facility) throw new Error("FORBIDDEN");

    const [units, leads, reservations, tasks] = await Promise.all([
      db.unit.findMany({
        where: { facilityId },
        select: { id: true, number: true, floor: true, zone: true, status: true, monthlyRate: true, updatedAt: true, unitType: { select: { name: true } } },
        orderBy: { number: "asc" },
      }),
      db.lead.findMany({
        where: { facilityId },
        select: { id: true, stage: true, source: true, expectedMoveIn: true, nextActionAt: true, updatedAt: true, desiredUnitType: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 250,
      }),
      db.reservation.findMany({
        where: { facilityId },
        select: { id: true, status: true, holdExpiresAt: true, intendedMoveIn: true, source: true, updatedAt: true, unit: { select: { number: true } } },
        orderBy: { updatedAt: "desc" },
        take: 250,
      }),
      db.task.findMany({
        where: { organisationId: auth.organisationId, facilityId },
        select: { id: true, title: true, status: true, priority: true, dueAt: true, completedAt: true, updatedAt: true },
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        take: 250,
      }),
    ]);

    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + SNAPSHOT_HOURS * 60 * 60 * 1000);
    await db.auditEvent.create({
      data: {
        organisationId: auth.organisationId,
        facilityId,
        actorId: auth.user.id,
        action: "offline.snapshot.downloaded",
        entityType: "Facility",
        entityId: facilityId,
        after: { expiresAt: expiresAt.toISOString(), unitCount: units.length, leadCount: leads.length, reservationCount: reservations.length, taskCount: tasks.length },
      },
    });

    return Response.json({
      data: {
        version: 1,
        generatedAt: generatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        facility,
        units: units.map((unit) => ({ ...unit, monthlyRate: unit.monthlyRate.toString() })),
        leads,
        reservations,
        tasks,
      },
    }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
