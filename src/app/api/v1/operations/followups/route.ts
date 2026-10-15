import { apiError } from "@/lib/api";
import { sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { createStaffFollowup, listStaffFollowups } from "@/lib/staff-followup-service";
import { staffFollowupSchema } from "@/lib/staff-followup-policy";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const managed = await requirePermissionScope("operations.manage").catch(error => { if (error instanceof Error && error.message === "FORBIDDEN") return null; throw error; });
    const params = new URL(request.url).searchParams;
    return Response.json({ data: { ...await listStaffFollowups(scope, params.get("search") ?? "", params.get("cursor")?.slice(0, 100)), canManage: !!managed && (scope.unrestrictedFacilities || managed.unrestrictedFacilities || scope.facilityIds.some(id => managed.facilityIds.includes(id))) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("operations.manage");
    const parsed = staffFollowupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { message: "Check the customer, store, staff, date and appointment details." } }, { status: 422 });
    return Response.json({ data: await createStaffFollowup(scope, parsed.data) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
