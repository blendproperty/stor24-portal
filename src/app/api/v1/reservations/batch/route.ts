import { z } from "zod";
import { apiError } from "@/lib/api";
import { sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { createReservationBatch } from "@/lib/leasing-service";
import { reservationSchema } from "@/lib/validators";

const schema = z.object({ facilityId: z.string().min(1).max(64), customerId: z.string().min(1).max(64), holdExpiresAt: z.iso.date().optional(), intendedMoveIn: z.iso.date().optional(), units: z.array(z.object({ unitId: z.string().min(1).max(64), quotedRate: z.number().finite().min(0).max(10000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7) }).strict()).min(2).max(20) }).strict();
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { message: "Check the reservation details." } }, { status: 422 });
    const { facilityId, customerId, holdExpiresAt, intendedMoveIn, units } = parsed.data;
    const scope = await requirePermissionScope("reservations.manage", facilityId);
    const items = units.map(unit => reservationSchema.parse({ ...unit, facilityId, customerId, holdExpiresAt, intendedMoveIn }));
    return Response.json({ data: await createReservationBatch(scope, items) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
