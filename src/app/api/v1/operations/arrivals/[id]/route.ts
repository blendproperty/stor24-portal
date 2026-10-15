import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { arrivalChangeSchema } from "@/lib/staff-attention-policy";
import { changeArrivalHandover } from "@/lib/staff-arrivals-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("operations.view");
    const parsed = arrivalChangeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { message: "Check the handover details and reload its current version." } }, { status: 422 });
    const write = parsed.data.action === "ACKNOWLEDGE" ? scope : await requirePermissionScope("operations.manage");
    return Response.json({ data: await changeArrivalHandover(write, (await context.params).id, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
