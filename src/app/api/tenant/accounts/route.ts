import { db } from "@/lib/db";
import { requireTenantSession } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export async function GET() {
  try {
    const session = await requireTenantSession();
    const customer = tenantCustomerScope(session);
    const accounts = await db.account.findMany({ where: { customer }, select: {
      id: true, customerId: true, accountNumber: true, balance: true, currency: true,
      tenancy: { select: { id: true, status: true, facility: { select: { name: true } }, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, orderBy: { startDate: "desc" }, take: 1, select: { unit: { select: { id: true, number: true } } } } } },
    }, orderBy: { createdAt: "desc" } });
    const documents = await db.document.findMany({ where: { tenancy: { customer }, OR: [{ type: "LEASE_AGREEMENT", provider: "BLENDSIGN", status: "SIGNED", externalId: { not: null } }, { type: { in: ["INVOICE", "STATEMENT"] }, status: "SENT", content: { not: null } }] }, select: { id: true, type: true, createdAt: true, tenancy: { select: { accountId: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    const agreements = await db.publicReservationLease.findMany({ where: { reservation: { customer }, status: "SIGNED", signedPdf: { not: null } }, select: { id: true, signedAt: true, reservation: { select: { id: true, publicReference: true, unitId: true, convertedTenancy: { select: { accountId: true } } } } }, orderBy: { signedAt: "desc" }, take: 200 });
    const payments = await db.payment.findMany({ where: { account: { customer }, status: "SUCCEEDED" }, select: { id: true, accountId: true, amount: true, currency: true, processedAt: true, createdAt: true, account: { select: { accountNumber: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    const reservations = await db.reservation.findMany({
      where: { customer, OR: [{ publicLease: { status: "SIGNED" } }, { convertedTenancyId: { not: null } }] },
      select: { id: true, customerId: true, status: true, publicReference: true, unitId: true, unit: { select: { number: true } }, facility: { select: { name: true } }, convertedTenancy: { select: { accountId: true } }, packageSelection: { select: { packageName: true, status: true, priceSnapshot: true, itemsSnapshot: true, fulfilledAt: true } } },
      orderBy: { createdAt: "desc" },
    });
    // Contract keys avoid mixing two different tenancies that reused the same physical unit.
    const units = accounts.flatMap(account => account.tenancy?.occupancies[0] ? [{
      key: `account:${account.id}`, unitId: account.tenancy.occupancies[0].unit.id,
      number: account.tenancy.occupancies[0].unit.number, facilityName: account.tenancy.facility.name,
      accountId: account.id, status: account.tenancy.status,
      reservations: reservations.filter(reservation => reservation.convertedTenancy?.accountId === account.id),
    }] : []);
    const bookingUnits = reservations.filter(reservation => !units.some(unit => unit.accountId === reservation.convertedTenancy?.accountId)).map(reservation => ({
      key: `reservation:${reservation.id}`, unitId: reservation.unitId, number: reservation.unit.number,
      // The public Netcash service creates this exact reservation-bound account number.
      // Match both customer and reference; do not infer links from names or amounts.
      facilityName: reservation.facility.name, accountId: reservation.convertedTenancy?.accountId ?? accounts.find(account => !account.tenancy && account.customerId === reservation.customerId && account.accountNumber === `ST24-T-${reservation.id}`)?.id ?? null,
      status: reservation.status, reservations: [reservation],
    }));
    const merchandiseRequests = await db.tenantMerchandiseRequest.findMany({ where: { customer }, select: { id: true, unitKey: true, unitId: true, items: true, total: true, createdAt: true, task: { select: { status: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    await db.auditEvent.create({ data: { organisationId: session.organisationId, action: "tenant_portal.accounts_viewed", entityType: "Customer", entityId: session.customerIds[0] } });
    return Response.json({ data: { accounts, units: [...units, ...bookingUnits], documents, agreements, payments, merchandiseRequests, expiresAt: session.expiresAt } }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
