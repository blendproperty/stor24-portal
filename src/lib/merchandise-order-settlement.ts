import { db } from "@/lib/db";
import { merchandisePaymentDecision, type MerchandiseOrderStatus, type MerchandiseOrderPayment } from "@/lib/merchandise-order-policy";

/** Internal only: caller must obtain verification from the provider, never browser data. */
export async function settleVerifiedMerchandisePayment(paymentId: string, verified: MerchandiseOrderPayment) {
  return db.$transaction(async tx => {
    const linked = await tx.merchandiseOrder.findUnique({ where: { paymentId }, select: { id: true } });
    if (!linked) throw new Error("MERCHANDISE_ORDER_NOT_FOUND");
    // Same lock as cancellation/expiry: a late payment cannot resurrect released stock.
    await tx.$queryRaw`SELECT "id" FROM "MerchandiseOrder" WHERE "id" = ${linked.id} FOR UPDATE`;
    const order = await tx.merchandiseOrder.findUniqueOrThrow({ where: { id: linked.id }, include: { payment: true } });
    const payment = order.payment;
    if (!payment || payment.accountId !== order.accountId || payment.provider !== "NETCASH" || payment.currency !== order.currency || payment.amount.toString() !== order.total.toString()) throw new Error("MERCHANDISE_PAYMENT_MISMATCH");
    const decision = merchandisePaymentDecision({ status: order.status as MerchandiseOrderStatus, paymentReference: payment.id, total: order.total.toFixed(2), currency: order.currency, stockHeld: order.stockHeld }, verified);
    if (!decision.postPayment) return order;
    // An independently posted payment requires reconciliation, not a second credit.
    const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: { not: "SUCCEEDED" } }, data: { status: "SUCCEEDED", processedAt: new Date(), failureCode: null } });
    if (claimed.count !== 1) throw new Error("MERCHANDISE_PAYMENT_RECONCILIATION_REQUIRED");
    await tx.ledgerEntry.create({ data: { accountId: order.accountId, type: "PAYMENT", amount: order.total, description: `Merchandise payment · ${order.id}`, effectiveAt: new Date(), externalRef: `merchandise-payment:${payment.id}`, metadata: { orderId: order.id, paymentId: payment.id, unitId: order.unitId, provider: "NETCASH" } } });
    if (decision.status === "PAID") {
      await tx.ledgerEntry.create({ data: { accountId: order.accountId, type: "CHARGE", amount: order.total, description: `Packing supplies · ${order.id}`, effectiveAt: new Date(), externalRef: `merchandise-charge:${order.id}`, metadata: { orderId: order.id, unitId: order.unitId } } });
      // Matching charge/payment net to zero; do not disguise an old account balance.
    } else {
      await tx.account.update({ where: { id: order.accountId }, data: { balance: { decrement: order.total } } });
      await tx.task.create({ data: { organisationId: order.organisationId, facilityId: order.facilityId, title: `Late merchandise payment · ${order.id}`, description: "Payment received after the order was cancelled or its stock released. Review stock and arrange authorised fulfilment or refund. Do not fulfil automatically.", priority: "URGENT", dueAt: new Date() } });
    }
    const result = await tx.merchandiseOrder.update({ where: { id: order.id }, data: { status: decision.status } });
    await tx.auditEvent.create({ data: { organisationId: order.organisationId, facilityId: order.facilityId, action: "merchandise_order.payment_verified", entityType: "MerchandiseOrder", entityId: order.id, after: { status: decision.status, paymentId: payment.id } } });
    return result;
  });
}

/** Bounded worker primitive; callers must schedule this before checkout can be enabled. */
export async function expireMerchandiseOrders(now = new Date()) {
  const expired = await db.merchandiseOrder.findMany({ where: { status: "AWAITING_PAYMENT", expiresAt: { lte: now } }, select: { id: true }, orderBy: { expiresAt: "asc" }, take: 100 });
  let count = 0;
  for (const candidate of expired) {
    const changed = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "MerchandiseOrder" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const order = await tx.merchandiseOrder.findUniqueOrThrow({ where: { id: candidate.id }, include: { items: true } });
      if (order.status !== "AWAITING_PAYMENT" || order.expiresAt > now) return false;
      if (order.stockHeld) for (const item of [...order.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const released = await tx.product.updateMany({ where: { id: item.productId, quantityReserved: { gte: item.quantity } }, data: { quantityReserved: { decrement: item.quantity } } });
        if (released.count !== 1) throw new Error("MERCHANDISE_STOCK_REVIEW_REQUIRED");
      }
      await tx.merchandiseOrder.update({ where: { id: order.id }, data: { status: "EXPIRED", stockHeld: false } });
      await tx.auditEvent.create({ data: { organisationId: order.organisationId, facilityId: order.facilityId, action: "merchandise_order.expired", entityType: "MerchandiseOrder", entityId: order.id } });
      return true;
    });
    if (changed) count++;
  }
  return count;
}
