import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { assertMerchandiseFulfillable, type MerchandiseOrderStatus } from "@/lib/merchandise-order-policy";
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
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "MerchandiseOrder" WHERE "id" = ${owned.id} FOR UPDATE`;
      const order = await tx.merchandiseOrder.findUniqueOrThrow({ where: { id: owned.id }, include: { items: true, payment: { select: { id: true, status: true, accountId: true, amount: true, currency: true } } } });
      if (order.status === "FULFILLED") return { id: order.id, status: order.status, fulfilledAt: order.fulfilledAt };
      assertMerchandiseFulfillable({ status: order.status as MerchandiseOrderStatus, paymentReference: order.paymentId ?? "", total: order.total.toString(), currency: order.currency, stockHeld: order.stockHeld });
      if (!order.payment || order.payment.status !== "SUCCEEDED" || order.payment.accountId !== order.accountId || !order.payment.amount.equals(order.total) || order.payment.currency !== order.currency) throw new Error("MERCHANDISE_NOT_FULFILLABLE");
      for (const item of [...order.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const stock = await tx.product.updateMany({ where: { id: item.productId, facilityId: order.facilityId, organisationId: order.organisationId, quantityReserved: { gte: item.quantity }, quantityOnHand: { gte: item.quantity } }, data: { quantityReserved: { decrement: item.quantity }, quantityOnHand: { decrement: item.quantity } } });
        if (stock.count !== 1) throw new Error("MERCHANDISE_STOCK_REVIEW_REQUIRED");
        await tx.stockMovement.create({ data: { productId: item.productId, type: "SALE", quantity: -item.quantity, reason: "Paid tenant merchandise order fulfilled", reference: order.id, createdById: scope.user.id } });
      }
      const saved = await tx.merchandiseOrder.update({ where: { id: order.id }, data: { status: "FULFILLED", stockHeld: false, fulfilledAt: new Date() }, select: { id: true, status: true, fulfilledAt: true } });
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: order.facilityId, actorId: scope.user.id, action: "merchandise_order.fulfilled", entityType: "MerchandiseOrder", entityId: order.id } });
      return saved;
    });
    return Response.json({ data: result }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof Error && ["MERCHANDISE_NOT_FULFILLABLE", "MERCHANDISE_STOCK_REVIEW_REQUIRED"].includes(error.message)) return Response.json({ error: { message: "This order cannot be fulfilled. Verify payment and held stock before retrying." } }, { status: 409, headers: privateHeaders });
    return authErrorResponse(error);
  }
}
