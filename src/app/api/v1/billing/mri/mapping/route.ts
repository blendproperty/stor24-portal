import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { changeMriMapping, mriMappingReview } from "@/lib/mri-mapping-service";
import { mappingReviewCsv } from "@/lib/mri-mapping-policy";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const messages: Record<string, string> = {
  MRI_ORG_PERMISSION: "Organisation-wide MRI permission is required.",
  MRI_MAPPING_CHANGED: "The mapping changed. Reload before making another change.",
  MRI_MAPPING_INCOMPLETE: "Resolve every mapping review item before submitting or approving.",
  MRI_MAPPING_STATE: "Reload the mapping to check its current review stage.",
  MRI_MAPPING_SELF_APPROVAL: "Approval requires someone who has neither edited nor submitted this mapping.",
  MRI_MAPPING_VERSION: "The saved mapping requires administrator review and has not been overwritten.",
  MRI_MAPPING_DUPLICATE: "Multiple mapping records require administrator review.",
  DLP_TRANSFER_BLOCKED: "The download was blocked by the data protection policy. Review the content and System audit reference.",
};
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "MRI_ORG_PERMISSION", "MRI_MAPPING_SELF_APPROVAL"].includes(code) ? 403 : error instanceof z.ZodError || error instanceof SyntaxError || ["MANDATE_RESPONSE_TOO_LARGE", "MANDATE_RESPONSE_INVALID"].includes(code) ? 400 : messages[code] || (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) ? 409 : 500;
  return Response.json({ error: messages[code] ?? (status === 401 ? "Sign in is required." : status === 403 ? "Permission required." : status === 400 ? "Check the mapping fields and request size." : status === 409 ? messages.MRI_MAPPING_CHANGED : "Unable to save the mapping. Reload to check its state before retrying.") }, { status, headers });
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("mri.view");
    const lane = new URL(request.url).pathname.endsWith("/sandbox/mapping") ? "sandbox" : "primary";
    const review = await mriMappingReview(scope, lane);
    if (new URL(request.url).searchParams.get("format") === "csv") return await protectDlpResponse(new Response(mappingReviewCsv(review), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="mri-mapping-finance-review.csv"', "x-content-type-options": "nosniff" } }), { organisationId: scope.organisationId, actorId: scope.userId, resourceId: `mri-mapping:${review.revision ?? "unsaved"}` }, "confidential");
    let canManage = false;
    try { canManage = (await requirePermissionScope("mri.manage")).unrestrictedFacilities; } catch { /* Read-only users can inspect the review. */ }
    return Response.json({ review, canManage }, { headers });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("mri.manage");
    if (!scope.unrestrictedFacilities) throw new Error("MRI_ORG_PERMISSION");
    if (await rateLimit(`mri-mapping:${scope.organisationId}:${scope.userId}`, 30, 60000)) return Response.json({ error: "Wait a minute before making more mapping changes." }, { status: 429, headers });
    const input = JSON.parse((await boundedBody(new Response(request.body), 64000)).toString());
    const lane = new URL(request.url).pathname.endsWith("/sandbox/mapping") ? "sandbox" : "primary";
    return Response.json({ review: await changeMriMapping(scope, input, lane) }, { headers });
  } catch (e) { return failure(e); }
}
