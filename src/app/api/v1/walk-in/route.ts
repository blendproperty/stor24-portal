import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { startWalkIn } from "@/lib/walk-in-service";
import { apiError } from "@/lib/api";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const { facilityId } = z.object({ facilityId: z.string().min(1).max(64) }).strict().parse(await request.json());
    const scope = await requirePermissionScope("reservations.manage", facilityId);
    return Response.json({ data: await startWalkIn(scope, facilityId) }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
