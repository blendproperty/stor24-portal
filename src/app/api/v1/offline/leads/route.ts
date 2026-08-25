import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { offlineLeadSyncSchema } from "@/lib/validators";
import { syncOfflineLead } from "@/lib/offline-lead-service";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { code: "ORIGIN_REJECTED", message: "The request origin is not allowed." } }, { status: 403 });
  const parsed = offlineLeadSyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "The queued lead is invalid.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
  try {
    const scope = await requirePermissionScope("leads.create", parsed.data.facilityId);
    const data = await syncOfflineLead(scope, parsed.data);
    return Response.json({ data }, { status: data.idempotent ? 200 : 201, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    return apiError(error);
  }
}
