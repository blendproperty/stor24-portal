import { db } from "@/lib/db";
import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { cancelTenantMerchandise } from "@/lib/merchandise-order-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireTenantSession();
    const { id } = await context.params;
    const order = await db.merchandiseOrder.findFirst({
      where: { id, organisationId: session.organisationId, account: { customer: tenantCustomerScope(session) } },
      select: { id: true, isTest: true, unitId: true, status: true, total: true, currency: true, expiresAt: true, fulfilledAt: true, payment: { select: { id: true, status: true } },
        items: { select: { name: true, quantity: true, unitPrice: true } } },
    });
    if (!order) throw new Error("TENANT_NOT_FOUND");
    // Browser return parameters never determine payment status.
    const { payment, ...details } = order;
    const receiptId = payment?.status === "SUCCEEDED" ? payment.id : null;
    return Response.json({ data: { ...details, receiptId: order.isTest ? null : receiptId, testSucceeded: order.isTest && payment?.status === "TEST_SUCCEEDED" } }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}

export async function DELETE(request: Request, context: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: tenantPrivateHeaders });
  try {
    const session = await requireTenantSession();
    if (await tenantRateLimit(`tenant-order-cancel:${session.organisationId}:${session.email}`, 10, 60000)) {
      return Response.json({ error: "Please wait a minute before trying again." }, { status: 429, headers: tenantPrivateHeaders });
    }
    const { id } = await context.params;
    const order = await cancelTenantMerchandise(session, id);
    const cancelled = order.status === "CANCELLED" || order.status === "EXPIRED";
    return Response.json({ data: { id: order.id, status: order.status }, message: cancelled
      ? "Your unpaid order is closed. Any payment already in progress will be reviewed by your store if it arrives."
      : "This order cannot be cancelled here. Please contact your store for assistance." },
      { status: cancelled ? 200 : 409, headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
