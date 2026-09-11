import { db } from "@/lib/db";
import { requireTenantSession } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const query = new URL(request.url).searchParams;
    const accountId = query.get("account") ?? "";
    const unitId = query.get("unit") ?? "";
    const account = await db.account.findFirst({ where: { id: accountId, customer: tenantCustomerScope(session) }, select: { id: true } });
    if (!account) throw new Error("TENANT_NOT_FOUND");
    const orders = await db.merchandiseOrder.findMany({ where: { accountId: account.id, unitId, organisationId: session.organisationId, status: { in: ["AWAITING_PAYMENT", "PAYMENT_REVIEW"] } }, select: { id: true, status: true, total: true, currency: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 20 });
    return Response.json({ data: orders }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
