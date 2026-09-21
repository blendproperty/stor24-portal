import { z } from "zod";
import { authErrorResponse } from "@/lib/auth-guards";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { billingPeriodSchema } from "@/lib/monthly-billing-policy";
import { cancelDebitRun, debitRunReview, debitWorkspace, getDebitPlan, prepareDebitRun, previewDebitRun, refreshAccountDebitMandate, refreshDebitRun, saveDebitPlan, submitDebitRun } from "@/lib/debit-order-service";
import { debitMessage } from "@/lib/debit-order-messages";
const batch = { facilityId: z.string().cuid(), period: billingPeriodSchema, actionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ...batch }).strict(),
  z.object({ action: z.literal("prepare"), ...batch, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("plan"), accountId: z.string().cuid(), plan: z.unknown() }).strict(),
  z.object({ action: z.literal("refresh-mandate"), accountId: z.string().cuid() }).strict(),
  z.object({ action: z.literal("submit"), id: z.string().cuid(), confirmBatchName: z.string().min(1) }).strict(),
  z.object({ action: z.literal("refresh"), id: z.string().cuid() }).strict(),
  z.object({ action: z.literal("cancel"), id: z.string().cuid(), confirm: z.literal(true) }).strict(),
]);
function failure(error: unknown) {
  const auth = authErrorResponse(error); if (auth) return auth;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the supplied values." }, { status: 400 });
  const code = error instanceof Error ? error.message : "";
  if (/^(DEBIT|NETCASH|MANDATE)_/.test(code)) return Response.json({ error: debitMessage(code) }, { status: 409 });
  if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return Response.json({ error: "Another user changed this run. Reload and review again." }, { status: 409 });
  return Response.json({ error: "The debit-order operation could not be completed. Reload the run before retrying." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("debit_orders.view");
    const accountId = new URL(request.url).searchParams.get("accountId");
    const runId = new URL(request.url).searchParams.get("runId");
    const result = runId ? await debitRunReview(scope, z.string().cuid().parse(runId)) : accountId ? await getDebitPlan(scope, z.string().cuid().parse(accountId)) : await debitWorkspace(scope);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const input = schema.parse(await request.json());
    const permission = input.action === "preview" ? "debit_orders.view" : input.action === "submit" ? "debit_orders.submit" : "debit_orders.manage";
    const scope = await requirePermissionScope(permission);
    let result: unknown;
    switch (input.action) {
      case "preview": result = await previewDebitRun(scope, input.facilityId, input.period, input.actionDate); break;
      case "prepare": result = await prepareDebitRun(scope, input.facilityId, input.period, input.actionDate, input.fingerprint); break;
      case "plan": result = await saveDebitPlan(scope, input.accountId, input.plan); break;
      case "refresh-mandate": result = await refreshAccountDebitMandate(scope, input.accountId); break;
      case "cancel": result = await cancelDebitRun(scope, input.id); break;
      case "submit": result = await submitDebitRun(scope, input.id, input.confirmBatchName); break;
      case "refresh": result = await refreshDebitRun(scope, input.id); break;
    }
    return Response.json(result ?? { ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
