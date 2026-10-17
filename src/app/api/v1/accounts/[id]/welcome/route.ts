import { db } from "@/lib/db";
import { requirePermission, authErrorResponse } from "@/lib/auth-guards";
import { statementAccountScope } from "@/lib/finance/account-statement";
import { sameOrigin } from "@/lib/request-security";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sendTenantWelcome } from "@/lib/tenant-welcome-email";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403, headers: tenantPrivateHeaders });
  try {
    const auth = await requirePermission("billing.documents.send");
    const { id } = await params;
    const account = await db.account.findFirst({ where: statementAccountScope(id, auth.organisationId, auth.allowedFacilityIds), select: { customerId: true, accountNumber: true, tenancy: { select: { facilityId: true } } } });
    if (!account) return Response.json({ error: { message: "Account not found." } }, { status: 404, headers: tenantPrivateHeaders });
    let facilityId = account.tenancy?.facilityId;
    if (!facilityId && auth.allowedFacilityIds === null && account.accountNumber.startsWith("ST24-T-")) {
      const reservation = await db.reservation.findFirst({ where: { id: account.accountNumber.slice(7), customerId: account.customerId, customer: { organisationId: auth.organisationId }, facility: { organisationId: auth.organisationId } }, select: { facilityId: true } });
      facilityId = reservation?.facilityId;
    }
    if (!facilityId) throw new Error("WELCOME_SOURCE_REVIEW");
    const result = await sendTenantWelcome(account.customerId, auth.organisationId, { resend: true, actorId: auth.user.id, source: { kind: "ACCOUNT", id, facilityId } });
    if (result === "ineligible") return Response.json({ error: { message: "The customer must verify their email before a welcome email can be sent." } }, { status: 409, headers: tenantPrivateHeaders });
    if (result !== "sent") return Response.json({ error: { message: "A welcome email was recently sent or attempted. Please wait 10 minutes before resending." } }, { status: 429, headers: tenantPrivateHeaders });
    return Response.json({ message: "Welcome to My STOR24 email sent to the customer's verified email address." }, { headers: tenantPrivateHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "WELCOME_SOURCE_REVIEW") return Response.json({ error: { message: "The account's store link needs review before a welcome email can be sent." } }, { status: 409, headers: tenantPrivateHeaders });
    if (error instanceof Error && error.message === "WELCOME_DELIVERY_REVIEW_REQUIRED") return Response.json({ error: { message: "The email was attempted, but its final record could not be confirmed. Check delivery before resending." } }, { status: 503, headers: tenantPrivateHeaders });
    if (error instanceof Error && error.message === "WELCOME_DELIVERY_FAILED") return Response.json({ error: { message: "Email delivery could not be confirmed. Check delivery before resending, and allow 10 minutes between attempts." } }, { status: 503, headers: tenantPrivateHeaders });
    return authErrorResponse(error);
  }
}
