import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { eventAcknowledgeSchema, eventQuerySchema } from "@/lib/staff-attention-policy";
import { acknowledgeOperationalEvent, staffOperationalInbox } from "@/lib/staff-operational-events";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const parsed = eventQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: { message: "Reload the event inbox." } }, { status: 422 });
    return Response.json({ data: await staffOperationalInbox(scope, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("operations.view");
    const parsed = eventAcknowledgeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { message: "Reload the event before acknowledging it." } }, { status: 422 });
    return Response.json({ data: await acknowledgeOperationalEvent(scope, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
