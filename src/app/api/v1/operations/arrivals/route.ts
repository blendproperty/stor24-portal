import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { arrivalQuerySchema } from "@/lib/staff-attention-policy";
import { staffArrivals } from "@/lib/staff-arrivals-service";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const now = new Date();
    const parsed = arrivalQuerySchema.safeParse({ from: southAfricaDateKey(now), to: southAfricaDateKey(new Date(now.getTime() + 6 * 86400000)), ...Object.fromEntries(new URL(request.url).searchParams) });
    if (!parsed.success) return Response.json({ error: { message: "Choose valid dates covering up to32days and a permitted store." } }, { status: 422 });
    const result = await staffArrivals(scope, parsed.data);
    const manage = await requirePermissionScope("operations.manage").catch(error => { if (error instanceof Error && error.message === "FORBIDDEN") return null; throw error; });
    return Response.json({ data: { ...result, query: parsed.data, manageableFacilityIds: result.facilities.filter(f => manage && (manage.unrestrictedFacilities || manage.facilityIds.includes(f.id))).map(f => f.id) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
