import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { mriBatchReview, saveMriBatch, transitionMriBatch, mriBatchCsv } from "@/lib/mri-batch-service";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const messages: Record<string, string> = {
  MRI_BATCH_CHANGED: "The batch changed. Reload before continuing.", MRI_BATCH_IMMUTABLE: "This batch cannot be edited. Reopen a pending review, or retain the approved/void record and use a new test period.",
  MRI_BATCH_BLOCKED: "Resolve mapping, period and balance blockers before review or export.", MRI_BATCH_STATE: "Reload and check the batch's current review stage.",
  MRI_BATCH_SELF_APPROVAL: "An independent reviewer who has not prepared or submitted the batch must approve it.", MRI_BATCH_DUPLICATE_SOURCE: "A source reference is already reserved by another sandbox period. Investigate rather than resubmitting it.",
  MRI_BATCH_INTEGRITY: "The saved snapshot failed integrity checks. Administrator review is required.", MRI_MONTH: "Choose a valid current or past calendar month.", DLP_TRANSFER_BLOCKED: "Data protection blocked the download. Review System audit.",
};
function failure(e: unknown) {
  const code = e instanceof Error ? e.message : "";
  const status = code === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "MRI_ORG_PERMISSION", "MRI_BATCH_SELF_APPROVAL"].includes(code) ? 403 : e instanceof z.ZodError || e instanceof SyntaxError || ["MANDATE_RESPONSE_TOO_LARGE", "MANDATE_RESPONSE_INVALID"].includes(code) ? 400 : messages[code] || (e && typeof e === "object" && "code" in e && ["P2002", "P2034"].includes(String(e.code))) ? 409 : 500;
  return Response.json({ error: messages[code] ?? (status === 401 ? "Sign in is required." : status === 403 ? "Organisation-wide MRI permission is required." : status === 400 ? "Check the source fields and request size." : "The request could not complete. Reload the saved state before retrying.") }, { status, headers });
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("mri.view"), params = new URL(request.url).searchParams;
    const period = params.get("period") ?? "";
    if (params.get("format") === "csv") return await protectDlpResponse(new Response(await mriBatchCsv(scope, period, z.string().uuid().parse(params.get("revision"))), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="sandbox-journal-review.csv"' } }), { organisationId: scope.organisationId, actorId: scope.userId, resourceId: `mri-sandbox-batch:${period}` }, "confidential");
    let canManage = false; try { canManage = (await requirePermissionScope("mri.manage")).unrestrictedFacilities; } catch { /* read only */ }
    return Response.json({ batch: await mriBatchReview(scope, period), canManage }, { headers });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("mri.manage"); if (!scope.unrestrictedFacilities) throw Error("MRI_ORG_PERMISSION");
    if (await rateLimit(`mri-batch:${scope.organisationId}:${scope.userId}`, 30, 60000)) return Response.json({ error: "Wait a minute before further batch changes." }, { status: 429, headers });
    const input = JSON.parse((await boundedBody(new Response(request.body), 100000)).toString());
    if (input && input.action === "save") { const body = { ...input }; delete body.action; return Response.json({ batch: await saveMriBatch(scope, body) }, { headers }); }
    return Response.json({ batch: await transitionMriBatch(scope, input) }, { headers });
  } catch (e) { return failure(e); }
}
