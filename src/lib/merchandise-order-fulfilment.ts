import { db } from "@/lib/db";
import { assertMerchandiseFulfillable, type MerchandiseOrderStatus } from "@/lib/merchandise-order-policy";

/** Internal transaction boundary: caller must first authorise inventory.manage for this facility. */
export async function fulfilMerchandiseOrder(orderId: string, scope: { organisationId: string; facilityId: string; user: { id: string } }) {
  return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "MerchandiseOrder" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.merchandiseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payment: { select: { id: true, status: true, accountId: true, amount: true, currency: true } } } });
      if (order.isTest || order.organisationId !== scope.organisationId || order.facilityId !== scope.facilityId) throw new Error("MERCHANDISE_NOT_FULFILLABLE");
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
}
