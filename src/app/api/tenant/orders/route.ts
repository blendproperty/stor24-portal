import { db } from "@/lib/db";
import { requireTenantSession } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const accountId = new URL(request.url).searchParams.get("account") ?? "";
    const account = await db.account.findFirst({ where: { id: accountId, customer: tenantCustomerScope(session) }, select: { id: true } });
    if (!account) throw new Error("TENANT_NOT_FOUND");
    const orders = await db.merchandiseOrder.findMany({ where: { accountId: account.id, organisationId: session.organisationId, status: { in: ["PAID", "FULFILLED"] }, payment: { status: "SUCCEEDED", accountId: account.id } }, select: { id: true, unitId: true, status: true, total: true, currency: true, paymentId: true, createdAt: true, fulfilledAt: true, items: { select: { name: true, quantity: true, unitPrice: true, product: { select: { imageUrl: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return Response.json({ data: orders }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
