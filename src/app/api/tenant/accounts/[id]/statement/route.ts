import { db } from "@/lib/db";
import { requireTenantSession, tenantEmailHtml, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPdf, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { getStatementData } from "@/lib/finance/statement-data";
import { renderAccountStatementPdf } from "@/lib/finance/tenant-document-pdf";
import { emailProvider, escapeEmailHtml } from "@/lib/email";
import { sameOrigin, privacyHash } from "@/lib/request-security";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireTenantSession();
    if (await tenantRateLimit(`tenant:statement:${session.tokenHash}`, 20, 60000)) throw new Error("TENANT_RATE_LIMITED");
    const { id } = await params, query = new URL(request.url).searchParams;
    const data = await getStatementData({ id, customer: tenantCustomerScope(session) }, query.get("from") ?? "", query.get("to") ?? "");
    if (query.get("format") === "pdf") {
      const bytes = await renderAccountStatementPdf(data);
      await db.auditEvent.create({ data: { organisationId: session.organisationId, action: "tenant_portal.statement_downloaded", entityType: "Account", entityId: id } });
      return tenantPdf(bytes, `stor24-statement-${data.from}-${data.to}.pdf`);
    }
    return Response.json({ data }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  try {
    const session = await requireTenantSession();
    const { id } = await params;
    const input = await request.json();
    if (typeof input.from !== "string" || typeof input.to !== "string") throw new Error("INVALID_PERIOD");
    await getStatementData({ id, customer: tenantCustomerScope(session) }, input.from, input.to);
    if (await tenantRateLimit(`tenant:statement-mail:${privacyHash(session.email)}`, 5, 3600000)) return Response.json({ error: "Email limit reached. You can still download your statement here." }, { status: 429 });
    const organisation = await db.organisation.findUniqueOrThrow({ where: { id: session.organisationId }, select: { slug: true } });
    if (!process.env.APP_URL) throw new Error("PORTAL_URL_UNCONFIGURED");
    const link = new URL("/my", process.env.APP_URL);
    link.search = new URLSearchParams({ organisation: organisation.slug, account: id, from: input.from, to: input.to }).toString();
    await emailProvider().send({ to: session.email, subject: "Your STOR24 statement is ready to view", text: `Sign in securely to view and download your statement for ${input.from} to ${input.to}: ${link}. This link does not grant access; email verification is required.`, html: tenantEmailHtml("Your statement, safely in reach.", `<p>Your statement for ${escapeEmailHtml(input.from)} to ${escapeEmailHtml(input.to)} is ready to view.</p><p><a href="${escapeEmailHtml(link.toString())}" style="display:inline-block;background:#ff5a0a;color:#071411;padding:16px 24px;border-radius:28px;font-weight:bold">Open My STOR24</a></p><p>Sign in with your verified email to view and download it. This link alone cannot unlock your account.</p>`) });
    await db.auditEvent.create({ data: { organisationId: session.organisationId, action: "tenant_portal.statement_link_emailed", entityType: "Account", entityId: id } });
    return Response.json({ message: "Secure statement link emailed to your verified address." }, { headers: tenantPrivateHeaders });
  } catch (error) { return tenantError(error); }
}
