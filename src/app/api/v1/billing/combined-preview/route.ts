import { authErrorResponse } from "@/lib/auth-guards";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { combinedBillingPreview, postCombinedBilling, combinedPreviewInput } from "@/lib/combined-billing-preview";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const body = await request.json();
    const { action, fingerprint, confirm, ...raw } = body;
    const input = combinedPreviewInput.parse(raw);
    if (action !== "preview" && action !== "post") throw new Error("COMBINED_INVALID_ACTION");
    const scope = await requirePermissionScope(action === "post" ? "billing.manage" : "billing.view");
    if (action === "post" && (confirm !== true || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))) throw new Error("COMBINED_CONFIRM_REQUIRED");
    return Response.json({ data: action === "post" ? await postCombinedBilling(scope, input, fingerprint) : await combinedBillingPreview(scope, input) }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof Error && /^(COMBINED_|BILLING_)/.test(error.message)) return Response.json({ error: { code: error.message, message: "This combined invoice needs finance review. No new invoice or charge was created." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
