import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireFacility, type RequestScope } from "@/lib/scope";
import { adjustedUnitRate, bulkUnitPricingSchema, unitPricingToken, type BulkUnitPricingInput } from "@/lib/bulk-unit-pricing";

export async function bulkUnitPricing(scope: RequestScope, input: BulkUnitPricingInput) {
  input = bulkUnitPricingSchema.parse(input);
  await requireFacility(scope, input.facilityId);
  return db.$transaction(async tx => {
    const ids = [...input.unitIds].sort();
    // Match booking/combination lock order before locking the selected units.
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${input.facilityId} FOR UPDATE`;
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Unit" WHERE "facilityId" = ${input.facilityId} AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
    const units = await tx.unit.findMany({
      where: { facilityId: input.facilityId, id: { in: ids } },
      select: { id: true, number: true, monthlyRate: true, updatedAt: true, combinedIntoUnitId: true },
      orderBy: { id: "asc" },
    });
    if (units.length !== ids.length || units.some(u => u.combinedIntoUnitId)) throw new Error("FORBIDDEN");
    const changes = units.map(u => ({ unitId: u.id, number: u.number, currentRate: u.monthlyRate.toFixed(2), proposedRate: adjustedUnitRate(u.monthlyRate.toString(), input.mode, input.value) }));
    const token = unitPricingToken({ facilityId: input.facilityId, mode: input.mode, value: input.value, changes, versions: units.map(u => u.updatedAt.toISOString()) });
    if (input.action === "apply") {
      if (input.expectedToken !== token) throw new Error("RATE_PREVIEW_STALE");
      for (const change of changes) {
        const before = units.find(u => u.id === change.unitId)!;
        await tx.unit.update({ where: { id: change.unitId }, data: { monthlyRate: change.proposedRate, updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)) } });
      }
      await tx.auditEvent.create({ data: {
        organisationId: scope.organisationId, actorId: scope.userId, facilityId: input.facilityId,
        action: "units.rates.adjusted", entityType: "Facility", entityId: input.facilityId,
        before: changes.map(c => ({ unitId: c.unitId, number: c.number, monthlyRate: c.currentRate })),
        after: { mode: input.mode, value: input.value, changes, previewToken: token },
      } });
    }
    return { facilityId: input.facilityId, action: input.action, token, changes };
  }, { timeout: 30_000 });
}
