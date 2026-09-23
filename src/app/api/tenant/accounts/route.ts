import { testPaymentReviewAccounts } from "@/lib/payments/test-payment-review";
import { getReservationMoveInReadiness } from "@/lib/reservation-move-in";
import { isFinancialReceipt, isTestPayment } from "@/lib/payments/payment-evidence";
import { db } from "@/lib/db";
import { requireTenantSession } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { tenantIdentitySelect } from "@/lib/tenant-identity-presentation";

export async function GET() {
  try {
    const session = await requireTenantSession();
    const customer = tenantCustomerScope(session);
    const accounts = await db.account.findMany({ where: { customer }, select: {
      id: true, customerId: true, accountNumber: true, balance: true, currency: true,
      tenancy: { select: { id: true, status: true, facility: { select: { name: true } }, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, orderBy: { startDate: "desc" }, take: 1, select: { accessState: true, unit: { select: { id: true, number: true } } } } } },
    }, orderBy: { createdAt: "desc" } });
    const documents = await db.document.findMany({ where: { tenancy: { customer }, OR: [{ type: "LEASE_AGREEMENT", provider: "BLENDSIGN", status: "SIGNED", externalId: { not: null } }, { type: { in: ["INVOICE", "STATEMENT"] }, status: "SENT", content: { not: null } }] }, select: { id: true, type: true, createdAt: true, tenancy: { select: { accountId: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    const agreements = await db.publicReservationLease.findMany({ where: { reservation: { customer }, status: "SIGNED", signedPdf: { not: null } }, select: { id: true, signedAt: true, reservation: { select: { id: true, publicReference: true, unitId: true, convertedTenancy: { select: { accountId: true } } } } }, orderBy: { signedAt: "desc" }, take: 200 });
    const payments = await db.payment.findMany({ where: { account: { customer }, status: { in: ["SUCCEEDED", "TEST_SUCCEEDED", "TEST_PENDING"] } }, select: { status: true, idempotencyKey: true, environment: true, id: true, accountId: true, amount: true, currency: true, processedAt: true, createdAt: true, account: { select: { accountNumber: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    const reservations = await db.reservation.findMany({
      where: { customer, OR: [{ publicLease: { status: "SIGNED" } }, { convertedTenancyId: { not: null } }] },
      select: { id: true, customerId: true, status: true, publicReference: true, unitId: true, identityDocument: { select: tenantIdentitySelect }, unit: { select: { number: true } }, facility: { select: { name: true } }, convertedTenancy: { select: { accountId: true } }, packageSelection: { select: { packageName: true, status: true, priceSnapshot: true, itemsSnapshot: true, fulfilledAt: true } } },
      orderBy: { createdAt: "desc" },
    });
    const reviewAccounts = await testPaymentReviewAccounts(accounts.map(account => account.id));
    const onboarding = await Promise.all(reservations.filter(r => r.status === "ACTIVE" && !r.convertedTenancy).map(async r => ({ reservationId: r.id, ...(await getReservationMoveInReadiness({ userId: "tenant-read-only", organisationId: session.organisationId, unrestrictedFacilities: true, facilityIds: [] }, r.id)) })));
    // Contract keys avoid mixing two different tenancies that reused the same physical unit.
    const units = accounts.flatMap(account => account.tenancy?.occupancies[0] ? [{
      key: `account:${account.id}`, unitId: account.tenancy.occupancies[0].unit.id,
      number: account.tenancy.occupancies[0].unit.number, facilityName: account.tenancy.facility.name,
      accountId: account.id, status: account.tenancy.status, accessState: account.tenancy.occupancies[0].accessState,
      reservations: reservations.filter(reservation => reservation.convertedTenancy?.accountId === account.id),
    }] : []);
    const bookingUnits = reservations.filter(reservation => !units.some(unit => unit.accountId === reservation.convertedTenancy?.accountId)).map(reservation => ({
      key: `reservation:${reservation.id}`, unitId: reservation.unitId, number: reservation.unit.number,
      // The public Netcash service creates this exact reservation-bound account number.
      // Match both customer and reference; do not infer links from names or amounts.
      facilityName: reservation.facility.name, accountId: reservation.convertedTenancy?.accountId ?? accounts.find(account => !account.tenancy && account.customerId === reservation.customerId && account.accountNumber === `ST24-T-${reservation.id}`)?.id ?? null,
      status: reservation.status, accessState: "NOT_ACTIVATED", reservations: [reservation],
    }));
    const merchandiseRequests = await db.tenantMerchandiseRequest.findMany({ where: { customer }, select: { id: true, unitKey: true, unitId: true, items: true, total: true, createdAt: true, task: { select: { status: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    await db.auditEvent.create({ data: { organisationId: session.organisationId, action: "tenant_portal.accounts_viewed", entityType: "Customer", entityId: session.customerIds[0] } });
    return Response.json({ data: { accounts: accounts.map(account => ({ ...account, balance: reviewAccounts.has(account.id) ? null : account.balance, financialReviewRequired: reviewAccounts.has(account.id) })), onboarding, units: [...units, ...bookingUnits], documents, agreements, payments: payments.filter(isFinancialReceipt), testPayments: payments.filter(isTestPayment).map(({ id, accountId, amount, currency, status }) => ({ id, accountId, amount, currency, status })), merchandiseRequests, expiresAt: session.expiresAt } }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
