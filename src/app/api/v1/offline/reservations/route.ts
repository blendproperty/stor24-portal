import { apiError } from "@/lib/api";
import { syncOfflineReservation } from "@/lib/offline-reservation-service";
import { sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { offlineReservationSyncSchema } from "@/lib/validators";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { code: "ORIGIN_REJECTED", message: "The request origin is not allowed." } }, { status: 403 });
  const parsed = offlineReservationSyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "The queued reservation request is invalid.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
  try {
    const scope = await requirePermissionScope("reservations.manage", parsed.data.facilityId);
    const data = await syncOfflineReservation(scope, parsed.data);
    return Response.json({ data }, { status: data.idempotent ? 200 : 201, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNIT_UNAVAILABLE") {
      return Response.json({ error: { code: "UNIT_UNAVAILABLE", message: "That unit is no longer available. Refresh the offline copy and choose another unit." } }, { status: 409 });
    }
    return apiError(error);
  }
}
