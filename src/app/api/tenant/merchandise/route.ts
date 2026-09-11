import { db } from "@/lib/db";
import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { merchandiseRequestSchema, priceMerchandise } from "@/lib/tenant-merchandise";

async function resolveUnit(key: string, customer: ReturnType<typeof tenantCustomerScope>) {
  if (key.startsWith("account:")) {
    const tenancy = await db.tenancy.findFirst({ where: { accountId: key.slice(8), customer, status: { in: ["ACTIVE", "DRAFT", "NOTICE_GIVEN"] } }, select: { facilityId: true, customerId: true, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, orderBy: { startDate: "desc" }, take: 1, select: { unitId: true, unit: { select: { number: true } } } } } });
    const occupancy = tenancy?.occupancies[0];
    if (tenancy && occupancy) return { facilityId: tenancy.facilityId, customerId: tenancy.customerId, unitId: occupancy.unitId, number: occupancy.unit.number };
  } else if (key.startsWith("reservation:")) {
    const reservation = await db.reservation.findFirst({ where: { id: key.slice(12), customer, publicLease: { status: "SIGNED" }, status: "ACTIVE", convertedTenancyId: null }, select: { facilityId: true, customerId: true, unitId: true, unit: { select: { number: true } } } });
    if (reservation) return { facilityId: reservation.facilityId, customerId: reservation.customerId, unitId: reservation.unitId, number: reservation.unit.number };
  }
  throw new Error("TENANT_NOT_FOUND");
}
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const unit = await resolveUnit(new URL(request.url).searchParams.get("unit") ?? "", tenantCustomerScope(session));
    const products = await db.product.findMany({ where: { facilityId: unit.facilityId, organisationId: session.organisationId, active: true }, select: { id: true, name: true, imageUrl: true, category: true, sellingPrice: true, quantityOnHand: true, quantityReserved: true }, orderBy: { name: "asc" } });
    return Response.json({ data: { products: products.map(product => ({ id: product.id, name: product.name, imageUrl: product.imageUrl, category: product.category, price: product.sellingPrice, available: Math.max(0, product.quantityOnHand - product.quantityReserved) })) } }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: tenantPrivateHeaders });
  try {
    const session = await requireTenantSession();
    const raw = await request.text();
    if (raw.length > 15000) return Response.json({ error: "Selection too large." }, { status: 422, headers: tenantPrivateHeaders });
    let json: unknown;
    try { json = JSON.parse(raw); } catch { json = null; }
    const parsed = merchandiseRequestSchema.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Choose valid products and quantities." }, { status: 422, headers: tenantPrivateHeaders });
    const input = parsed.data;
    const unit = await resolveUnit(input.unit, tenantCustomerScope(session));
    if (await tenantRateLimit(`tenant-merchandise:${session.organisationId}:${unit.customerId}`, 10, 60000)) return Response.json({ error: "Please wait a minute before submitting another request." }, { status: 429, headers: tenantPrivateHeaders });
    const where = { customerId_idempotencyKey: { customerId: unit.customerId, idempotencyKey: input.idempotencyKey } };
    const previous = await db.tenantMerchandiseRequest.findUnique({ where });
    if (previous) {
      if (previous.unitKey !== input.unit) return Response.json({ error: "Please start a new selection for this unit." }, { status: 409, headers: tenantPrivateHeaders });
      return Response.json({ data: { id: previous.id, total: previous.total }, message: "Your request is with your store. No payment has been taken; stock and collection will be confirmed." }, { headers: tenantPrivateHeaders });
    }
    const products = await db.product.findMany({ where: { id: { in: input.items.map(item => item.productId) }, facilityId: unit.facilityId, organisationId: session.organisationId, active: true } });
    const priced = priceMerchandise(input.items, products);
    const result = await db.$transaction(async tx => {
      const task = await tx.task.create({ data: { organisationId: session.organisationId, facilityId: unit.facilityId, customerId: unit.customerId, priority: "HIGH", title: `Packing supplies request · Unit ${unit.number}`, description: `My STOR24 merchandise request for ${input.unit}.\n${priced.items.map(item => `${item.quantity} × ${item.name} (${item.sku}) — R ${item.lineTotalZar}`).join("\n")}\nTotal quoted: R ${priced.total}\nNot paid. Stock is not reserved. Confirm availability, payment and collection with the customer. Completing this task does not post a payment, issue stock or mark the request as a purchase.`, dueAt: new Date() } });
      const saved = await tx.tenantMerchandiseRequest.create({ data: { facilityId: unit.facilityId, customerId: unit.customerId, unitId: unit.unitId, unitKey: input.unit, items: priced.items, total: priced.total, idempotencyKey: input.idempotencyKey, taskId: task.id } });
      await tx.auditEvent.create({ data: { organisationId: session.organisationId, action: "tenant_portal.merchandise_requested", entityType: "TenantMerchandiseRequest", entityId: saved.id } });
      return saved;
    }).catch(async error => {
      // The unique key rolls back the whole losing transaction, including its task.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const existing = await db.tenantMerchandiseRequest.findUnique({ where });
        if (existing?.unitKey === input.unit) return existing;
      }
      throw error;
    });
    return Response.json({ data: { id: result.id, total: result.total }, message: "Your request is with your store. No payment has been taken; stock and collection will be confirmed." }, { status: 201, headers: tenantPrivateHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "MERCHANDISE_UNAVAILABLE") return Response.json({ error: "Some products or quantities have changed. Refresh the catalogue and try again." }, { status: 409, headers: tenantPrivateHeaders });
    return tenantError(error);
  }
}
