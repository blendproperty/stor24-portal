import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { settlementActionSchema } from "@/lib/settlement-policy";
import { settlementAction, settlementCsv, settlementDetail, settlementWorkspace } from "@/lib/settlement-service";
const messages: Record<string, string> = {
  SETTLEMENT_UNSUPPORTED: "This transaction code needs a finance-approved mapping before review. Keep the exception open; do not relabel the original source.",
  SETTLEMENT_ORG_PERMISSION: "This workspace needs organisation-wide finance permission because a merchant statement can span stores.",
  SETTLEMENT_NOT_FOUND: "The record is unavailable in your organisation.",
  SETTLEMENT_CONFIG: "Review the merchant, environment and Account service key in Netcash configuration.",
  SETTLEMENT_DATE: "Choose a valid past statement date. Bank records and balance observations cannot be future dated.",
  SETTLEMENT_FORMAT: "Use a full daily Netcash tab-separated statement or the specified bank CSV format, with at most 500 transactions.",
  SETTLEMENT_AMOUNT: "Check the amount and exact four-decimal matching. Available funds cannot exceed current funds.",
  SETTLEMENT_DIRECTION: "A recognised transaction has an unexpected direction. Obtain the original full statement and investigate.",
  SETTLEMENT_BALANCE: "Opening balance plus all signed movements does not equal closing balance.",
  SETTLEMENT_DUPLICATE: "This day or provider transaction is already imported. Investigate before voiding any draft.",
  SETTLEMENT_CHANGED: "The record, configuration or review changed. Refresh and review again.",
  SETTLEMENT_RECEIPT: "The receipt needs verified live posting evidence, consistent corrections and a reconciled account without test history.",
  SETTLEMENT_MERCHANT: "The receipt belongs to another merchant, or its older merchant provenance needs explicit evidence.",
  SETTLEMENT_RETURN: "Select the exact posted refund or reversal with its original verified payment.",
  SETTLEMENT_BANK: "Select an available bank row with the opposite exact amount, matching environment and a date on or after the provider movement.",
  SETTLEMENT_TARGET: "This line requires a documented accounting reference, without a receipt or bank match.",
  SETTLEMENT_INDEPENDENT: "An independent reviewer must not have imported this statement or linked bank extract, or prepared its matches.",
  SETTLEMENT_INTEGRITY: "The saved source failed its integrity check. Investigate before proceeding.",
  SETTLEMENT_UNRESOLVED: "Resolve every exception against current source evidence before review.",
};
function failure(e: unknown) {
  const code = e instanceof Error ? e.message : "";
  if (["UNAUTHENTICATED", "FORBIDDEN", "SETTLEMENT_ORG_PERMISSION"].includes(code)) return Response.json({ error: messages[code] ?? (code === "UNAUTHENTICATED" ? "Sign in is required." : "You do not have permission for this action.") }, { status: code === "UNAUTHENTICATED" ? 401 : 403 });
  if (e instanceof z.ZodError || e instanceof SyntaxError) return Response.json({ error: "Check the dates, references, file and confirmation." }, { status: 400 });
  if (messages[code]) return Response.json({ error: messages[code] }, { status: 409 });
  if (code.startsWith("SETTLEMENT_PROVIDER")) return Response.json({ error: "Netcash could not supply this statement. Check the service key and past date; retry only the read request." }, { status: 502 });
  if (e && typeof e === "object" && "code" in e && ["P2002", "P2034"].includes(String(e.code))) return Response.json({ error: "A source is already reserved or changed concurrently. Refresh before retrying." }, { status: 409 });
  return Response.json({ error: "Unable to process the reconciliation. Refresh before retrying." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, exporting = params.get("export") === "csv";
    const scope = await requirePermissionScope(exporting ? "settlements.export" : "settlements.view");
    const id = params.has("id") ? z.string().cuid().parse(params.get("id")) : null;
    if (exporting) {
      if (!id) return Response.json({ error: "Choose a statement." }, { status: 400 });
      return new Response(await settlementCsv(scope, id), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="settlement-review.csv"', "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    return Response.json(id ? await settlementDetail(scope, id) : await settlementWorkspace(scope), { headers: { "cache-control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    // Authenticate before reading a potentially large upload.
    await requirePermissionScope("settlements.view");
    const body = await boundedBody(new Response(request.body), 600000);
    const input = settlementActionSchema.parse(JSON.parse(body.toString()));
    const permission = input.action === "preview" ? "view" : input.action === "approve" ? "approve" : ["resolve", "reopen", "void", "void-bank"].includes(input.action) ? "manage" : "import";
    const scope = await requirePermissionScope(`settlements.${permission}`);
    if (["request", "retrieve"].includes(input.action) && await rateLimit(`settlement-provider:${scope.organisationId}`, 10, 60000)) return Response.json({ error: "Wait a minute before another provider read." }, { status: 429 });
    return Response.json(await settlementAction(scope, input), { headers: { "cache-control": "no-store" } });
  } catch (e) { return failure(e); }
}
