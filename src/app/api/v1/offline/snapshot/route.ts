import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";

const SNAPSHOT_HOURS = 12;

async function snapshotRevision(facilityId: string, organisationId: string, facilityUpdatedAt: Date) {
  const [unit, lead, reservation, task] = await Promise.all([
    db.unit.aggregate({ where: { facilityId }, _max: { updatedAt: true }, _count: true }),
    db.lead.aggregate({ where: { facilityId }, _max: { updatedAt: true }, _count: true }),
    db.reservation.aggregate({ where: { facilityId }, _max: { updatedAt: true }, _count: true }),
    db.task.aggregate({ where: { organisationId, facilityId }, _max: { updatedAt: true }, _count: true }),
  ]);
  const revisionAt = [facilityUpdatedAt, unit._max.updatedAt, lead._max.updatedAt, reservation._max.updatedAt, task._max.updatedAt]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0].toISOString();
  const revision = createHash("sha256").update(JSON.stringify({ revisionAt, counts: [unit._count, lead._count, reservation._count, task._count] })).digest("hex");
  return { revision, revisionAt };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const facilityId = params.get("facilityId")?.trim();
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

    const { revision, revisionAt } = await snapshotRevision(facilityId, auth.organisationId, facility.updatedAt);
    if (params.get("check") === "1") {
      return Response.json({ data: { facilityId, revision, revisionAt } }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
    }

    const deviceId = params.get("deviceId")?.trim();
    const deviceLabel = params.get("deviceLabel")?.trim().slice(0, 80);
    if (!deviceId || !/^[a-zA-Z0-9-]{16,64}$/.test(deviceId)) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "A valid offline device identifier is required." } }, { status: 422 });
    }

    const [units, leads, reservations, tasks] = await Promise.all([
      db.unit.findMany({
        where: { facilityId },
        select: { id: true, number: true, floor: true, zone: true, status: true, monthlyRate: true, updatedAt: true, unitType: { select: { id: true, name: true } } },
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
        after: { deviceId, deviceLabel: deviceLabel || "Unnamed device", revision, revisionAt, expiresAt: expiresAt.toISOString(), unitCount: units.length, leadCount: leads.length, reservationCount: reservations.length, taskCount: tasks.length },
      },
    });

    return Response.json({
      data: {
        version: 1,
        generatedAt: generatedAt.toISOString(),
        revision,
        revisionAt,
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
