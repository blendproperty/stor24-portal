import { db } from "@/lib/db";
import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { sameOrigin } from "@/lib/request-security";
import { merchandiseRequestSchema } from "@/lib/tenant-merchandise";
import { holdTenantMerchandise } from "@/lib/merchandise-order-service";
import { createMerchandiseCheckout } from "@/lib/payments/netcash-service";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: tenantPrivateHeaders });
  try {
    const session = await requireTenantSession();
    if (await tenantRateLimit(`tenant-checkout:${session.organisationId}:${session.email}`, 5, 60000)) return Response.json({ error: "Please wait a minute before starting another checkout." }, { status: 429, headers: tenantPrivateHeaders });
    const raw = await request.text();
    if (raw.length > 15000) return Response.json({ error: "Selection too large." }, { status: 422, headers: tenantPrivateHeaders });
    let input: unknown;
    try { input = JSON.parse(raw); } catch { input = null; }
    const parsed = merchandiseRequestSchema.safeParse(input);
    if (!parsed.success) return Response.json({ error: "Choose valid products and quantities." }, { status: 422, headers: tenantPrivateHeaders });
    const order = await holdTenantMerchandise(session, parsed.data);
    try {
      const result = await createMerchandiseCheckout(session, order.id);
      return Response.json({ data: result }, { status: 201, headers: tenantPrivateHeaders });
    } catch {
      // Do not release a potentially issued payment's hold: status/cancel and expiry
      // resolve it safely. Never return provider/configuration exception details.
      return Response.json({ error: "Checkout could not be opened. Check this order before starting another purchase.", data: { orderId: order.id } }, { status: 409, headers: tenantPrivateHeaders });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "MERCHANDISE_RETRY_CONFLICT") return Response.json({ error: "This basket has changed. Start a new basket before checking out." }, { status: 409, headers: tenantPrivateHeaders });
    if (error instanceof Error && error.message === "MERCHANDISE_CHECKOUT_DISABLED") return Response.json({ error: "Online purchases are not available yet." }, { status: 503, headers: tenantPrivateHeaders });
    if (error instanceof Error && error.message === "MERCHANDISE_UNAVAILABLE") return Response.json({ error: "Stock or prices changed. Refresh the catalogue and choose again." }, { status: 409, headers: tenantPrivateHeaders });
    return tenantError(error);
  }
}

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
