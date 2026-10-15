import { apiError } from "@/lib/api";
import { sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { changeStaffFollowup } from "@/lib/staff-followup-service";
import { staffFollowupChangeSchema } from "@/lib/staff-followup-policy";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("operations.view");
    const parsed = staffFollowupChangeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { message: "Check the handover action and reload its current version." } }, { status: 422 });
    const write = parsed.data.action === "ACKNOWLEDGE" ? scope : await requirePermissionScope("operations.manage");
    return Response.json({ data: await changeStaffFollowup(write, (await context.params).id, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
