import { db } from "@/lib/db";
import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { tenantError, tenantPdf, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { fetchBlendSignArtifact } from "@/lib/blendsign-client";
import { renderTenantDocumentPdf } from "@/lib/finance/tenant-document-pdf";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const session = await requireTenantSession(), { kind, id } = await params;
    if (await tenantRateLimit(`tenant:download:${session.tokenHash}`, 20, 60000)) throw new Error("TENANT_RATE_LIMITED");
    const customer = tenantCustomerScope(session);
    let response: Response;
    if (kind === "agreement") {
      const lease = await db.publicReservationLease.findFirst({ where: { id, status: "SIGNED", signedPdf: { not: null }, reservation: { customer } }, select: { signedPdf: true } });
      if (!lease?.signedPdf) throw new Error("TENANT_NOT_FOUND");
      response = tenantPdf(lease.signedPdf, "stor24-signed-agreement.pdf");
    } else if (kind === "receipt") {
      const payment = await db.payment.findFirst({ where: { id, status: "SUCCEEDED", account: { customer } }, select: { amount: true, currency: true, method: true, processedAt: true, createdAt: true, account: { select: { accountNumber: true, customer: { select: { firstName: true, lastName: true, companyName: true } } } } } });
      if (!payment) throw new Error("TENANT_NOT_FOUND");
      const owner = payment.account.customer;
      response = tenantPdf(await renderTenantDocumentPdf({ title: "Payment receipt", reference: id, customerName: owner.companyName || [owner.firstName, owner.lastName].filter(Boolean).join(" "), subtitle: payment.account.accountNumber, columns: ["Detail", "Recorded value"], rows: [["Date", formatSouthAfricaDate(payment.processedAt ?? payment.createdAt)], ["Amount", `${payment.currency} ${payment.amount.toFixed(2)}`], ["Method", payment.method]], notes: ["Receipt for a successful payment recorded in STOR24. This is not a tax invoice or independent bank settlement confirmation."] }), "stor24-payment-receipt.pdf");
    } else if (kind === "issued") {
      const document = await db.document.findFirst({ where: { id, tenancy: { customer } }, select: { type: true, status: true, provider: true, externalId: true, content: true } });
      if (!document) throw new Error("TENANT_NOT_FOUND");
      if (document.type === "LEASE_AGREEMENT" && document.status === "SIGNED" && document.provider === "BLENDSIGN" && document.externalId) {
        const upstream = await fetchBlendSignArtifact(document.externalId, "signed");
        if (!upstream.ok) throw new Error("DOCUMENT_UNAVAILABLE");
        response = tenantPdf(new Uint8Array(await upstream.arrayBuffer()), "stor24-signed-agreement.pdf");
      } else if (["INVOICE", "STATEMENT"].includes(document.type) && document.status === "SENT" && document.content) {
        // Preserve the exact issued document; never regenerate or execute stored HTML in the portal.
        response = new Response(document.content, { headers: { ...tenantPrivateHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="stor24-issued-${document.type.toLowerCase()}.html"`, "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" } });
      } else throw new Error("TENANT_NOT_FOUND");
    } else throw new Error("TENANT_NOT_FOUND");
    await db.auditEvent.create({ data: { organisationId: session.organisationId, action: `tenant_portal.${kind}_downloaded`, entityType: "TenantDocument", entityId: id } });
    return response;
  } catch (error) { return tenantError(error); }
}
