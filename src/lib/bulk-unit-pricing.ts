import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

export const bulkUnitPricingSchema = z.object({
  facilityId: z.string().min(1).max(64),
  unitIds: z.array(z.string().min(1).max(64)).min(1).max(1000)
    .refine(ids => new Set(ids).size === ids.length, "Select each unit once."),
  mode: z.enum(["SET", "AMOUNT", "PERCENT"]),
  value: z.number().finite().multipleOf(0.01).min(-10_000_000).max(10_000_000),
  action: z.enum(["preview", "apply"]),
  expectedToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type BulkUnitPricingInput = z.infer<typeof bulkUnitPricingSchema>;

export function adjustedUnitRate(current: string, mode: BulkUnitPricingInput["mode"], value: number) {
  const old = new Prisma.Decimal(current);
  const amount = new Prisma.Decimal(value);
  const next = (mode === "SET" ? amount : mode === "AMOUNT" ? old.add(amount) : old.mul(amount.div(100).add(1)))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (next.isNegative() || next.greaterThan(10_000_000)) throw new Error("RATE_OUT_OF_RANGE");
  return next.toFixed(2);
}

export function unitPricingToken(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
