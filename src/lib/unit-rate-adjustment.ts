import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

const positiveDecimal = z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine(value => Number(value) > 0);
export const unitRateAdjustmentSchema = z.object({
  facilityId: z.string().min(1).max(64),
  areaSqMetres: positiveDecimal,
  direction: z.enum(["INCREASE", "REDUCE"]),
  mode: z.enum(["RAND", "PERCENT"]),
  value: positiveDecimal,
}).strict();
export type UnitRateAdjustment = z.infer<typeof unitRateAdjustmentSchema>;
export type RateAdjustmentUnit = {
  id: string; number: string; floor: string | null; status: string;
  monthlyRate: Prisma.Decimal; taxRate: Prisma.Decimal; updatedAt: Date;
  unitType: { name: string };
};

export function prepareUnitRateAdjustment(input: UnitRateAdjustment, units: RateAdjustmentUnit[]) {
  if (!units.length) throw Error("RATE_ADJUSTMENT_EMPTY");
  const changes = [...units].sort((a, b) => a.id.localeCompare(b.id)).map(unit => {
    const delta = input.mode === "RAND" ? new Prisma.Decimal(input.value) : unit.monthlyRate.mul(input.value).div(100);
    const rate = (input.direction === "INCREASE" ? unit.monthlyRate.add(delta) : unit.monthlyRate.sub(delta))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (rate.lte(0) || rate.gt("9999999999.99")) throw Error("RATE_ADJUSTMENT_INVALID_RATE");
    return { unitId: unit.id, number: unit.number, floor: unit.floor, status: unit.status, type: unit.unitType.name,
      oldRate: unit.monthlyRate.toFixed(2), newRate: rate.toFixed(2) };
  });
  const updated = changes.filter(row => row.oldRate !== row.newRate).length;
  if (!updated) throw Error("RATE_ADJUSTMENT_NO_CHANGE");
  const sum = (field: "oldRate" | "newRate") => changes.reduce((total, row) => total.add(row[field]), new Prisma.Decimal(0)).toFixed(2);
  const plan = { ...input, changes, updated, oldTotal: sum("oldRate"), newTotal: sum("newRate") };
  const revisions = [...units].sort((a, b) => a.id.localeCompare(b.id)).map(unit => [unit.id, unit.updatedAt.toISOString(), unit.taxRate.toString()]);
  return { ...plan, previewHash: createHash("sha256").update(JSON.stringify({ plan, revisions })).digest("hex") };
}
