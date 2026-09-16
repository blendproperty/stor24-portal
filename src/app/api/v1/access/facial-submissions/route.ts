import { apiError } from "@/lib/api";
import { listPendingFacialSubmissions } from "@/lib/facial-access-service";
import { requirePermissionScope } from "@/lib/scope";

export async function GET() {
  try {
    const scope = await requirePermissionScope("access.view");
    const data = await listPendingFacialSubmissions(scope);
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
