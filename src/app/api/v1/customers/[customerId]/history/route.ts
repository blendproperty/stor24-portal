import { apiError } from "@/lib/api";
import { customerHistory, addCustomerNote } from "@/lib/customer-history-service";
import { customerNoteSchema, historyQuerySchema } from "@/lib/customer-history-policy";
import { requirePermissionScope, type RequestScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";

type Context = { params: Promise<{ customerId: string }> };
async function optionalScope(permission: string): Promise<RequestScope | null> {
  try { return await requirePermissionScope(permission); }
  catch (error) { if (error instanceof Error && error.message === "FORBIDDEN") return null; throw error; }
}
export async function GET(request: Request, context: Context) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const { customerId } = await context.params;
    const parsed = historyQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: { message: "Check the history filters." } }, { status: 422 });
    const [communications, collections, write, financial] = await Promise.all([optionalScope("communications.view"), optionalScope("collections.view"), optionalScope("operations.manage"), optionalScope("ledger.view")]);
    const exported = await optionalScope("customer_history.export");
    const canExport = !!exported && (scope.unrestrictedFacilities || exported.unrestrictedFacilities || scope.facilityIds.some(id => exported.facilityIds.includes(id)));
    return Response.json({ data: { ...await customerHistory(scope, customerId, parsed.data, { communications, collections, write, financial }), canExport } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "HISTORY_SOURCE_LIMIT") return Response.json({ error: { message: "This customer has too many linked tenancies for a combined history. Select a specific history type." } }, { status: 422 });
    if (error instanceof Error && ["HISTORY_CURSOR_INVALID", "HISTORY_DATE_INVALID"].includes(error.message)) return Response.json({ error: { message: "Reload customer history to continue." } }, { status: 422 });
    return apiError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const scope = await requirePermissionScope("operations.manage");
    const { customerId } = await context.params;
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: { message: "Check the note details." } }, { status: 422 }); }
    const parsed = customerNoteSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: { message: "Choose a store and category and enter a note of up to 5,000 characters." } }, { status: 422 });
    return Response.json({ data: await addCustomerNote(scope, customerId, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
