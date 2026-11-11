import { z } from "zod";
import { apiError } from "@/lib/api";
import { sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { moveInBatch } from "@/lib/leasing-service";
import { moveInSchema } from "@/lib/validators";

const money = z.number().finite().min(0).max(10000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7);
const schema = z.object({
  requestKey: z.string().uuid(),
  facilityId: z.string().min(1).max(64),
  customerId: z.string().min(1).max(64),
  paymentMethod: z.enum(["DEBIT_ORDER", "CARD", "EFT", "OTHER"]),
  units: z.array(z.object({ unitId: z.string().min(1).max(64), startDate: z.iso.date(), monthlyRate: money, initialCharge: money }).strict()).min(1).max(20),
}).strict();

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { message: "Check all unit details and try again." } }, { status: 422 });
    const { facilityId, customerId, paymentMethod, units, requestKey } = parsed.data;
    const scope = await requirePermissionScope("move_in.create", facilityId);
    const inputs = units.map(unit => moveInSchema.parse({ ...unit, facilityId, customerId, paymentMethod, accessState: "PENDING" }));
    const batch = await moveInBatch(scope, requestKey, inputs);
    return Response.json({ data: { documents: batch.items } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
