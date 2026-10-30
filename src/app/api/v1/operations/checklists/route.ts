import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { checklistChangeSchema, checklistCreateSchema } from "@/lib/operational-checklist-policy";
import { createOperationalChecklist, changeOperationalChecklist, operationalChecklists } from "@/lib/operational-checklist-service";

const messages: Record<string, string> = {
  CHECKLIST_INCOMPLETE: "Complete every item. Explain failed, skipped and discrepant checks; enter each padlock count.",
  CHECKLIST_COMPARISON_REQUIRED: "Record the rent roll and collections-list reference used for the padlock comparison.",
  CHECKLIST_SOURCE_CHANGED: "The unit list or recorded overlock work changed. Save your notes, then restart the walkthrough with the current list.",
  CHECKLIST_REVIEWER_REQUIRED: "Choose a reviewer separate from the preparer, cover and submitting staff member.",
  CHECKLIST_EMPTY: "There are no units to inspect at this store.", CHECKLIST_LIMIT: "This store exceeds the supported checklist limit. Contact your administrator.",
  CHECKLIST_TIMEZONE: "The store must be configured for Africa/Johannesburg.", CHECKLIST_NOT_DUE: "This check window has not started yet.",
};
function failure(error: unknown) {
  if (error instanceof Error && error.message === "MFA_REQUIRED") return Response.json({ error: { message: "Complete two-step verification before using checklists." } }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  if (error instanceof z.ZodError) return Response.json({ error: { message: error.issues[0]?.message ?? "Review the checklist fields." } }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  if (error instanceof Error && (messages[error.message] || error.message === "INVALID_JSON" || error.message === "CONFLICT")) return Response.json({ error: { message: messages[error.message] ?? (error.message === "CONFLICT" ? "This record changed or is closed. Reload before acting." : "Send valid checklist details.") } }, { status: error.message === "CONFLICT" || error.message === "CHECKLIST_SOURCE_CHANGED" ? 409 : 422, headers: { "Cache-Control": "private, no-store" } });
  const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response;
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view"), params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => params.getAll(k).length !== 1)) throw new Error("INVALID_JSON");
    const query = z.object({ facilityId: z.string().cuid().optional(), id: z.string().cuid().optional(), closed: z.enum(["true", "false"]).optional(), cursor: z.string().cuid().optional() }).strict().parse(Object.fromEntries(params));
    return Response.json({ data: await operationalChecklists(scope, { ...query, closed: query.closed === "true" }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const input = checklistCreateSchema.parse(await jsonBody(request)), scope = await requirePermissionScope("operations.manage", input.facilityId);
    return Response.json({ data: await createOperationalChecklist(scope, input) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("operations.view"), input = checklistChangeSchema.parse(await jsonBody(request));
    return Response.json({ data: { id: await changeOperationalChecklist(scope, input) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
