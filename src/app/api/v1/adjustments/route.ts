import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { adjustmentInputSchema, adjustmentMessages, evidenceText } from "@/lib/adjustment-policy";
import { adjustmentAccount, adjustmentDocument, adjustmentWorkspace, decideAdjustment, previewAdjustment, recordRefundPayout, requestAdjustment } from "@/lib/adjustment-service";
const id = z.string().cuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), input: adjustmentInputSchema }).strict(),
  z.object({ action: z.literal("request"), input: adjustmentInputSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.string().uuid(), confirm: z.literal(true) }).strict(),
  z.object({ action: z.enum(["approve", "reject", "cancel"]), id, reference: evidenceText, confirm: z.literal(true), unpaidConfirmed: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("record-payout"), id, reference: evidenceText, date: z.string(), paidConfirmed: z.literal(true) }).strict(),
]);
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") return Response.json({ error: code === "UNAUTHENTICATED" ? "Sign in is required." : "You do not have permission for this action." }, { status: code === "UNAUTHENTICATED" ? 401 : 403 });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the amount, reason and supporting reference." }, { status: 400 });
  if (adjustmentMessages[code]) return Response.json({ error: adjustmentMessages[code] }, { status: 409 });
  if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return Response.json({ error: adjustmentMessages.ADJUSTMENT_DUPLICATE }, { status: 409 });
  return Response.json({ error: "The adjustment could not be completed. Reload its history before retrying." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("adjustments.view");
    const params = new URL(request.url).searchParams;
    if (params.has("document")) return new Response(await adjustmentDocument(scope, id.parse(params.get("document"))), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'", "x-content-type-options": "nosniff" } });
    const data = params.has("accountId") ? await adjustmentAccount(scope, id.parse(params.get("accountId"))) : await adjustmentWorkspace(scope);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const body = schema.parse(await request.json());
    const permission = body.action === "preview" ? "adjustments.view" : ["approve", "reject"].includes(body.action) ? "adjustments.approve" : body.action === "record-payout" ? "adjustments.record_refund" : "adjustments.request";
    const scope = await requirePermissionScope(permission);
    let result;
    if (body.action === "preview") result = await previewAdjustment(scope, body.input);
    else if (body.action === "request") result = await requestAdjustment(scope, body.input, body.fingerprint, body.requestKey);
    else if (body.action === "record-payout") result = await recordRefundPayout(scope, body.id, body.reference, body.date);
    else result = await decideAdjustment(scope, body.id, body.action, body.reference, body.unpaidConfirmed);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
