import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { fulfilMerchandiseOrder } from "@/lib/merchandise-order-fulfilment";
import { z } from "zod";

const privateHeaders = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    const scope = await requirePermission("inventory.manage");
    const orders = await db.merchandiseOrder.findMany({ where: { organisationId: scope.organisationId, ...(scope.allowedFacilityIds ? { facilityId: { in: scope.allowedFacilityIds } } : {}), status: { in: ["PAID", "PAYMENT_REVIEW", "FULFILLED"] } }, select: { id: true, facilityId: true, unitId: true, status: true, total: true, currency: true, createdAt: true, fulfilledAt: true, items: { select: { name: true, sku: true, quantity: true, unitPrice: true } }, account: { select: { accountNumber: true, customer: { select: { id: true, firstName: true, lastName: true, companyName: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return Response.json({ data: orders }, { headers: privateHeaders });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { message: "Request not allowed." } }, { status: 403, headers: privateHeaders });
  try {
    const scope = await requirePermission("inventory.manage");
    const input = z.object({ id: z.string().min(1).max(100), action: z.literal("fulfil") }).strict().parse(await request.json());
    const owned = await db.merchandiseOrder.findFirst({ where: { id: input.id, organisationId: scope.organisationId, ...(scope.allowedFacilityIds ? { facilityId: { in: scope.allowedFacilityIds } } : {}) }, select: { id: true, facilityId: true } });
    if (!owned) return Response.json({ error: { message: "Order not found." } }, { status: 404, headers: privateHeaders });
    await requirePermission("inventory.manage", owned.facilityId);
    const result = await fulfilMerchandiseOrder(owned.id, { organisationId: scope.organisationId, facilityId: owned.facilityId, user: scope.user });
    return Response.json({ data: result }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof Error && ["MERCHANDISE_NOT_FULFILLABLE", "MERCHANDISE_STOCK_REVIEW_REQUIRED"].includes(error.message)) return Response.json({ error: { message: "This order cannot be fulfilled. Verify payment and held stock before retrying." } }, { status: 409, headers: privateHeaders });
    return authErrorResponse(error);
  }
}
