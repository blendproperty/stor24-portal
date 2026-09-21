import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { collectionActionSchema } from "@/lib/collections-policy";
import { collectionCsv } from "@/lib/collections-view";
import { collectionsWorkspace, updateCollection } from "@/lib/collections-service";
import { southAfricaDateKey } from "@/lib/south-africa-time";
const messages: Record<string, string> = {
  COLLECTION_NOT_FOUND: "This account is outside your permitted stores.", COLLECTION_CHANGED: "This case changed or the request was already used. Reload before retrying.", COLLECTION_DATE: "Check the date. Reports cannot be future dated and new follow-ups cannot be backdated.", COLLECTION_TERMS: "Check the due-date overrides against this account's original charges.", COLLECTION_OWNER: "Choose an active colleague permitted to manage collections at this store.", COLLECTION_PROMISE: "Check the overdue balance, holds, existing promise and verified receipt evidence.", COLLECTION_LIMIT: "More than 2,000 accounts are in scope. An administrator must arrange a narrower store role before running this report.",
};
function failure(e: unknown) {
  const code = e instanceof Error ? e.message : "";
  if (["UNAUTHENTICATED", "FORBIDDEN"].includes(code)) return Response.json({ error: code === "UNAUTHENTICATED" ? "Sign in is required." : "You do not have permission for this action." }, { status: code === "UNAUTHENTICATED" ? 401 : 403 });
  if (e instanceof z.ZodError || e instanceof SyntaxError) return Response.json({ error: "Check the dates, amount, notes and confirmation." }, { status: 400 });
  if (messages[code]) return Response.json({ error: messages[code] }, { status: 409 });
  if (e && typeof e === "object" && "code" in e && ["P2002", "P2034"].includes(String(e.code))) return Response.json({ error: messages.COLLECTION_CHANGED }, { status: 409 });
  return Response.json({ error: "Unable to load or save collections. Reload before retrying." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, exporting = params.get("export") === "csv";
    const scope = await requirePermissionScope(exporting ? "collections.export" : "collections.view");
    const data = await collectionsWorkspace(scope, params.get("asOf") ?? southAfricaDateKey(new Date()));
    if (exporting) return new Response(collectionCsv(data, { search: params.get("search") ?? "", facility: params.get("facility") ?? "", owner: params.get("owner") ?? "", mode: params.get("mode") ?? "all" }), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="collections-${data.asOf}.csv"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const input = collectionActionSchema.parse(await request.json());
    const scope = await requirePermissionScope(input.action === "terms" ? "collections.policy" : "collections.manage");
    return Response.json(await updateCollection(scope, input), { headers: { "cache-control": "no-store" } });
  } catch (e) { return failure(e); }
}
