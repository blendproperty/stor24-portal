import { db } from "@/lib/db";
import { requireTenantSession } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export async function GET() {
  try {
    const session = await requireTenantSession();
    const customer = tenantCustomerScope(session);
    const accounts = await db.account.findMany({ where: { customer }, select: {
      id: true, accountNumber: true, balance: true, currency: true,
      tenancy: { select: { status: true, facility: { select: { name: true } }, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, orderBy: { startDate: "desc" }, take: 1, select: { unit: { select: { number: true } } } } } },
    }, orderBy: { createdAt: "desc" } });
    const documents = await db.document.findMany({ where: { tenancy: { customer }, OR: [{ type: "LEASE_AGREEMENT", provider: "BLENDSIGN", status: "SIGNED", externalId: { not: null } }, { type: { in: ["INVOICE", "STATEMENT"] }, status: "SENT", content: { not: null } }] }, select: { id: true, type: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 200 });
    const agreements = await db.publicReservationLease.findMany({ where: { reservation: { customer }, status: "SIGNED", signedPdf: { not: null } }, select: { id: true, signedAt: true, reservation: { select: { publicReference: true } } }, orderBy: { signedAt: "desc" }, take: 200 });
    const payments = await db.payment.findMany({ where: { account: { customer }, status: "SUCCEEDED" }, select: { id: true, amount: true, currency: true, processedAt: true, createdAt: true, account: { select: { accountNumber: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    await db.auditEvent.create({ data: { organisationId: session.organisationId, action: "tenant_portal.accounts_viewed", entityType: "Customer", entityId: session.customerIds[0] } });
    return Response.json({ data: { accounts, documents, agreements, payments, expiresAt: session.expiresAt } }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
