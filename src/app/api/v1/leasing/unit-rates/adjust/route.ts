import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/request-security";
import { requireFacility, requirePermissionScope } from "@/lib/scope";
import { prepareUnitRateAdjustment, unitRateAdjustmentSchema } from "@/lib/unit-rate-adjustment";

const command = z.discriminatedUnion("action", [
  unitRateAdjustmentSchema.extend({ action: z.literal("preview") }),
  unitRateAdjustmentSchema.extend({ action: z.literal("apply"), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
const messages: Record<string, string> = {
  RATE_ADJUSTMENT_EMPTY: "No units match this size at this store. Refresh inventory and select a size again.",
  RATE_ADJUSTMENT_INVALID_RATE: "Every resulting monthly rate must be above zero and within the supported range. Reduce the adjustment.",
  RATE_ADJUSTMENT_NO_CHANGE: "This adjustment rounds to the existing prices. Enter a larger adjustment.",
  RATE_ADJUSTMENT_STALE: "The units or prices changed after your preview. Nothing was saved. Preview the adjustment again.",
};

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) return Response.json({ error: { message: "Choose a size, direction and a positive amount with up to two decimal places." } }, { status: 422 });
    const { action, ...values } = parsed.data;
    const input = unitRateAdjustmentSchema.parse({ facilityId: values.facilityId, areaSqMetres: values.areaSqMetres,
      direction: values.direction, mode: values.mode, value: values.value });
    const scope = await requirePermissionScope("inventory.manage", input.facilityId);
    await requireFacility(scope, input.facilityId);
    const result = await db.$transaction(async tx => {
      const units = await tx.unit.findMany({
        where: { facilityId: input.facilityId, combinedIntoUnitId: null,
          unitType: { facilityId: input.facilityId, areaSqMetres: input.areaSqMetres } },
        select: { id: true, number: true, floor: true, status: true, monthlyRate: true, taxRate: true, updatedAt: true,
          unitType: { select: { name: true } } },
      });
      const plan = prepareUnitRateAdjustment(input, units);
      if (action === "preview") return plan;
      if (parsed.data.action !== "apply" || parsed.data.previewHash !== plan.previewHash) throw Error("RATE_ADJUSTMENT_STALE");
      for (const row of plan.changes.filter(row => row.oldRate !== row.newRate)) {
        const saved = await tx.unit.updateMany({ where: { id: row.unitId, facilityId: input.facilityId, monthlyRate: row.oldRate,
          updatedAt: units.find(unit => unit.id === row.unitId)!.updatedAt }, data: { monthlyRate: row.newRate } });
        if (saved.count !== 1) throw Error("RATE_ADJUSTMENT_STALE");
      }
      const event = await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId,
        facilityId: input.facilityId, action: "units.size_rates.adjusted", entityType: "Facility", entityId: input.facilityId,
        before: { changes: plan.changes.map(row => ({ unitId: row.unitId, monthlyRate: row.oldRate })) },
        after: plan } });
      return { ...plan, auditEventId: event.id };
    }, { isolationLevel: "Serializable", timeout: 20000 });
    return Response.json({ data: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (messages[code]) return Response.json({ error: { code, message: messages[code] } }, { status: code === "RATE_ADJUSTMENT_STALE" ? 409 : 422 });
    if (typeof error === "object" && error && "code" in error && error.code === "P2034")
      return Response.json({ error: { code: "RATE_ADJUSTMENT_STALE", message: messages.RATE_ADJUSTMENT_STALE } }, { status: 409 });
    if (code === "INVALID_JSON") return Response.json({ error: { message: "The submitted adjustment is invalid." } }, { status: 422 });
    if (code === "MFA_REQUIRED") return Response.json({ error: { message: "Complete two-step verification before adjusting prices." } }, { status: 403 });
    return apiError(error);
  }
}
