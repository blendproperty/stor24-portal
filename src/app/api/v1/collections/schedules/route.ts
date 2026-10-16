import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { commandCollectionSchedule, readCollectionSchedules, SCHEDULE_VIEW } from "@/lib/collection-schedule-service";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const querySchema = z.object({ facilityId: z.union([z.cuid(), z.literal("")]).optional(), planId: z.string().max(120).optional(), cursor: z.string().max(600).optional(), runCursor: z.string().max(600).optional(), accountSearch: z.string().max(100).optional() }).strict();
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : error instanceof z.ZodError || error instanceof SyntaxError || code.startsWith("MANDATE_RESPONSE_") ? 400 : 409;
  const message = status === 401 ? "Sign in again to review schedules." : status === 403 ? "Current collection schedule access at this store is required." : status === 400 ? "Check the explicit schedule, audience and review fields." : code === "COLLECTION_SCHEDULE_SELF_APPROVAL" || code === "COLLECTION_NOTICE_SELF_APPROVAL" ? "An independent authorised colleague must review every recipient and letter." : code === "COLLECTION_SCHEDULE_NOT_DUE" ? "This schedule is outside its current South African day and review window." : "This schedule, source, sender or review is unavailable or changed. Reload the retained record before continuing.";
  return Response.json({ error: message }, { status, headers });
}
export async function GET(request: Request) {
  try { const scope = await requirePermissionScope(SCHEDULE_VIEW); const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams)); return Response.json({ data: await readCollectionSchedules(scope, query) }, { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope(SCHEDULE_VIEW);
    if (await rateLimit(`collection-schedule:${scope.organisationId}:${scope.userId}`, 20, 60000)) return Response.json({ error: "Wait a minute before more schedule actions." }, { status: 429, headers });
    const input = JSON.parse((await boundedBody(new Response(request.body), 12000)).toString());
    return Response.json({ data: await commandCollectionSchedule(scope, input) }, { headers });
  } catch (error) { return failure(error); }
}
