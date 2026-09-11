import { db } from "@/lib/db";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { merchandiseRequestSchema, priceMerchandise } from "@/lib/tenant-merchandise";
import { assertMerchandiseCheckoutEnabled } from "@/lib/merchandise-checkout-access";

/** No caller accepts a client price, facility, customer or payment amount. */
export async function holdTenantMerchandise(session: Parameters<typeof tenantCustomerScope>[0], raw: unknown) {
  assertMerchandiseCheckoutEnabled(session);
  const input = merchandiseRequestSchema.parse(raw);
  return db.$transaction(async tx => {
    let accountId: string;
    let facilityId: string;
    let unitId: string;
    if (input.unit.startsWith("account:")) {
      const account = await tx.account.findFirst({ where: { id: input.unit.slice(8), customer: tenantCustomerScope(session), tenancy: { status: "ACTIVE" } }, select: { id: true, currency: true, tenancy: { select: { facilityId: true, occupancies: { where: { status: "ACTIVE" }, select: { unitId: true } } } } } });
      if (!account || account.currency !== "ZAR" || account.tenancy?.occupancies.length !== 1) throw new Error("TENANT_NOT_FOUND");
      accountId = account.id; facilityId = account.tenancy.facilityId; unitId = account.tenancy.occupancies[0].unitId;
    } else {
      // Signed, unconverted bookings already have a reservation-bound billing
      // account. Buying supplies must not activate or convert the storage booking.
      const reservation = await tx.reservation.findFirst({ where: { id: input.unit.slice(12), customer: tenantCustomerScope(session), status: "ACTIVE", convertedTenancyId: null, publicLease: { status: "SIGNED" } }, select: { id: true, customerId: true, facilityId: true, unitId: true } });
      if (!reservation) throw new Error("TENANT_NOT_FOUND");
      const account = await tx.account.findFirst({ where: { accountNumber: `ST24-T-${reservation.id}`, customerId: reservation.customerId, customer: tenantCustomerScope(session), tenancy: null }, select: { id: true, currency: true } });
      if (!account || account.currency !== "ZAR") throw new Error("TENANT_NOT_FOUND");
      accountId = account.id; facilityId = reservation.facilityId; unitId = reservation.unitId;
    }
    // Serialize same-account retries before creating stock holds; no duplicate order.
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    const existing = await tx.merchandiseOrder.findUnique({ where: { accountId_idempotencyKey: { accountId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
    if (existing) {
      const requested = new Map(input.items.map(item => [item.productId, item.quantity]));
      if (existing.unitId !== unitId || existing.items.length !== requested.size || existing.items.some(item => requested.get(item.productId) !== item.quantity)) {
        throw new Error("MERCHANDISE_RETRY_CONFLICT");
      }
      return existing;
    }
    const products = await tx.product.findMany({ where: { id: { in: input.items.map(item => item.productId) }, organisationId: session.organisationId, facilityId, active: true } });
    const priced = priceMerchandise(input.items, products);
    if (Number(priced.total) <= 0) throw new Error("MERCHANDISE_INVALID_TOTAL");
    // Stable lock order avoids two baskets deadlocking on opposite product orders.
    for (const item of [...priced.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const changed = await tx.$executeRaw`UPDATE "Product" SET "quantityReserved" = "quantityReserved" + ${item.quantity}, "updatedAt" = NOW() WHERE "id" = ${item.productId} AND "organisationId" = ${session.organisationId} AND "facilityId" = ${facilityId} AND "active" = true AND "sellingPrice" = ${item.unitPriceZar}::decimal AND "quantityOnHand" - "quantityReserved" >= ${item.quantity}`;
      if (changed !== 1) throw new Error("MERCHANDISE_UNAVAILABLE");
    }
    const order = await tx.merchandiseOrder.create({ data: { accountId, organisationId: session.organisationId, facilityId, unitId, total: priced.total, idempotencyKey: input.idempotencyKey, expiresAt: new Date(Date.now() + 20 * 60000), items: { create: priced.items.map(item => ({ productId: item.productId, name: item.name, sku: item.sku, quantity: item.quantity, unitPrice: item.unitPriceZar })) } }, include: { items: true } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId, action: "merchandise_order.stock_held", entityType: "MerchandiseOrder", entityId: order.id } });
    return order;
  });
}

/** Release is allowed even when new checkout is disabled, so rollback remains possible. */
export async function cancelTenantMerchandise(session: Parameters<typeof tenantCustomerScope>[0], orderId: string) {
  return db.$transaction(async tx => {
    const owned = await tx.merchandiseOrder.findFirst({ where: { id: orderId, organisationId: session.organisationId, account: { customer: tenantCustomerScope(session) } }, select: { id: true } });
    if (!owned) throw new Error("TENANT_NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "MerchandiseOrder" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.merchandiseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.status !== "AWAITING_PAYMENT") return order;
    if (order.stockHeld) for (const item of [...order.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const released = await tx.product.updateMany({ where: { id: item.productId, quantityReserved: { gte: item.quantity } }, data: { quantityReserved: { decrement: item.quantity } } });
      if (released.count !== 1) throw new Error("MERCHANDISE_STOCK_REVIEW_REQUIRED");
    }
    const cancelled = await tx.merchandiseOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", stockHeld: false } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: order.facilityId, action: "merchandise_order.cancelled", entityType: "MerchandiseOrder", entityId: order.id } });
    return cancelled;
  });
}
