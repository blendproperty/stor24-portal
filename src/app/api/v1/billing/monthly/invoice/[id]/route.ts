import { db } from "@/lib/db";
import { requirePermissionScope } from "@/lib/scope";
import { authErrorResponse } from "@/lib/auth-guards";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requirePermissionScope("billing.view");
    const { id } = await context.params;
    const document = await db.document.findFirst({ where: { id, type: "INVOICE", idempotencyKey: { startsWith: "monthly-invoice:" }, tenancy: { customer: { organisationId: scope.organisationId }, facility: { organisationId: scope.organisationId }, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) } } });
    if (!document?.content) return new Response("Not found", { status: 404 });
    return new Response(document.content, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return authErrorResponse(error); }
}
