import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { MIDRAND_MARKET_RATE_VERSION, recommendedMidrandMonthlyRate } from "@/lib/unit-pricing";
import { sameOrigin } from "@/lib/request-security";

const inputSchema = z.object({ facilityId: z.string().min(1), modelVersion: z.literal(MIDRAND_MARKET_RATE_VERSION) });

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const actor = await requireOwner();
    const parsed = inputSchema.safeParse(await jsonBody(request));
    if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const facility = await db.facility.findFirst({ where: { id: parsed.data.facilityId, organisationId: actor.user.organisationId }, select: { id: true, name: true } });
    if (!facility) throw new Error("NOT_FOUND");
    const units = await db.unit.findMany({ where: { facilityId: facility.id }, select: { id: true, floor: true, unitType: { select: { areaSqMetres: true } } } });
    const skipped = units.filter((unit) => !unit.unitType.areaSqMetres || Number(unit.unitType.areaSqMetres) <= 0);
    const groups = new Map<number, string[]>();
    for (const unit of units) {
      const area = Number(unit.unitType.areaSqMetres ?? 0);
      if (area <= 0) continue;
      const rate = recommendedMidrandMonthlyRate(area, unit.floor);
      groups.set(rate, [...(groups.get(rate) ?? []), unit.id]);
    }
    if (!groups.size) return Response.json({ error: { code: "UNIT_AREAS_REQUIRED", message: "No units at this store have a rentable area." } }, { status: 422 });
    const updates = [...groups.entries()].map(([monthlyRate, ids]) => db.unit.updateMany({ where: { id: { in: ids }, facilityId: facility.id }, data: { monthlyRate } }));
    const results = await db.$transaction(updates);
    const updated = results.reduce((sum, result) => sum + result.count, 0);
    await db.auditEvent.create({ data: { organisationId: actor.user.organisationId, actorId: actor.userId, facilityId: facility.id, action: "units.market_rates.applied", entityType: "Facility", entityId: facility.id, after: { modelVersion: parsed.data.modelVersion, updated, skipped: skipped.length, minimumRate: Math.min(...groups.keys()), maximumRate: Math.max(...groups.keys()) } } });
    return Response.json({ data: { facilityId: facility.id, facilityName: facility.name, modelVersion: parsed.data.modelVersion, updated, skipped: skipped.length, minimumRate: Math.min(...groups.keys()), maximumRate: Math.max(...groups.keys()) } });
  } catch (error) {
    return apiError(error);
  }
}
