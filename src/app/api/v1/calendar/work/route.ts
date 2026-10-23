import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { scheduledWorkSchema } from "@/lib/scheduled-work-policy";
import { changeScheduledWork, createScheduledWork, scheduledWorkPage } from "@/lib/scheduled-work-service";

function failure(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: { message: error.issues[0]?.message ?? "Review the schedule details." } }, { status: 422 });
  if (error instanceof Error && error.message === "CONFLICT") return Response.json({ error: { message: "This task or request changed. Reload before saving again." } }, { status: 409 });
  if (error instanceof Error && error.message === "SCHEDULE_CLOSED") return Response.json({ error: { message: "Completed and cancelled occurrences are retained as history. Create a new task." } }, { status: 409 });
  if (error instanceof Error && error.message === "SCHEDULE_TIMEZONE_UNSUPPORTED") return Response.json({ error: { message: "This scheduler supports stores configured for Africa/Johannesburg. Review the store timezone." } }, { status: 422 });
  return apiError(error);
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const url = new URL(request.url);
    const start = new Date(z.iso.datetime().parse(url.searchParams.get("start"))), end = new Date(z.iso.datetime().parse(url.searchParams.get("end")));
    if (end <= start || end.getTime() - start.getTime() > 32 * 86400000) throw new z.ZodError([{ code: "custom", path: [], message: "Choose up to 31 days." }]);
    return Response.json({ data: await scheduledWorkPage(scope, start, end) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const { input, requestKey } = z.object({ input: scheduledWorkSchema, requestKey: z.uuid() }).strict().parse(await jsonBody(request));
    const scope = await requirePermissionScope("operations.manage", input.facilityId);
    return Response.json({ data: await createScheduledWork(scope, input, requestKey) });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const body = z.object({ id: z.string().cuid(), version: z.iso.datetime(), input: scheduledWorkSchema, status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"]) }).strict().parse(await jsonBody(request));
    const scope = await requirePermissionScope("operations.manage", body.input.facilityId);
    return Response.json({ data: await changeScheduledWork(scope, body.id, body.version, body.input, body.status) });
  } catch (error) { return failure(error); }
}
