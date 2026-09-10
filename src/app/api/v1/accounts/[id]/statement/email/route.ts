import { db } from "@/lib/db";
import { requirePermission, authErrorResponse } from "@/lib/auth-guards";
import { statementAccountScope, statementPeriod } from "@/lib/finance/account-statement";
import { emailProvider, escapeEmailHtml } from "@/lib/email";
import { tenantEmailHtml, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { sameOrigin, privacyHash } from "@/lib/request-security";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
  try {
    const auth = await requirePermission("billing.documents.send");
    const { id } = await params;
    const input = await request.json();
    if (typeof input.from !== "string" || typeof input.to !== "string") throw new Error("INVALID_PERIOD");
    statementPeriod(input.from, input.to);
    const account = await db.account.findFirst({ where: statementAccountScope(id, auth.organisationId, auth.allowedFacilityIds), select: { customer: { select: { email: true, emailVerifiedAt: true, organisation: { select: { slug: true } } } } } });
    if (!account) return Response.json({ error: { message: "Account not found." } }, { status: 404 });
    if (!account.customer.email || !account.customer.emailVerifiedAt) return Response.json({ error: { message: "The customer must verify their email before secure statement delivery is available." } }, { status: 409 });
    if (await tenantRateLimit(`tenant:staff-mail:${privacyHash(account.customer.email)}`, 5, 3600000)) return Response.json({ error: { message: "Delivery limit reached for this customer. Please try again later." } }, { status: 429 });
    if (!process.env.APP_URL) throw new Error("PORTAL_URL_UNCONFIGURED");
    const link = new URL("/my", process.env.APP_URL);
    link.search = new URLSearchParams({ organisation: account.customer.organisation.slug, account: id, from: input.from, to: input.to }).toString();
    await emailProvider().send({ to: account.customer.email, subject: "Your STOR24 statement is ready to view", text: `Sign in to My STOR24 to view your statement: ${link}. A sign-in code will be sent to your verified email.`, html: tenantEmailHtml("Your statement, safely in reach.", `<p>Your statement for ${escapeEmailHtml(input.from)} to ${escapeEmailHtml(input.to)} is available in My STOR24.</p><p><a href="${escapeEmailHtml(link.toString())}">View and download your statement</a></p><p>Sign in with your verified email. This link alone does not grant access to your account.</p>`) });
    await db.auditEvent.create({ data: { organisationId: auth.organisationId, actorId: auth.user.id, action: "account.statement_link_emailed", entityType: "Account", entityId: id } });
    return Response.json({ message: "Secure statement link sent to the customer's verified email." }, { headers: tenantPrivateHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PERIOD") return Response.json({ error: { message: "Choose valid statement dates." } }, { status: 422 });
    return authErrorResponse(error);
  }
}
