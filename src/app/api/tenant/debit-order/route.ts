import { db } from "@/lib/db";
import { prepareStaffMandateSession } from "@/lib/debit-mandate-session";
import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("TENANT_NOT_FOUND");
    const session = await requireTenantSession();
    if (await tenantRateLimit(`tenant:mandate:${session.tokenHash}`, 10, 60000)) throw new Error("TENANT_RATE_LIMITED");
    const input = await request.json().catch(() => null);
    const customer = tenantCustomerScope(session);
    if (typeof input?.id !== "string" || input.id.length > 100) throw new Error("TENANT_NOT_FOUND");
    if (input.kind === "public") {
      const lease = await db.publicReservationLease.findFirst({ where: { id: input.id, status: "SIGNED", paymentMethod: "DEBIT_ORDER", reservation: { customer } }, select: { signingToken: true } });
      if (!lease) throw new Error("TENANT_NOT_FOUND");
      return Response.json({ data: { setupUrl: `https://stor24.co.za/book/debit-order/${encodeURIComponent(lease.signingToken)}` } }, { headers: tenantPrivateHeaders });
    }
    if (input.kind !== "staff") throw new Error("TENANT_NOT_FOUND");
    const data = await prepareStaffMandateSession({ userId: "tenant-session", organisationId: session.organisationId, unrestrictedFacilities: true, facilityIds: [] }, input.id, customer);
    return Response.json({ data }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
