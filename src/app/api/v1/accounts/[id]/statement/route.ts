import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { buildAccountStatement, statementPeriod, statementAccountScope } from "@/lib/finance/account-statement";
import { renderAccountStatementPdf } from "@/lib/finance/tenant-document-pdf";
import { tenantPdf } from "@/lib/tenant-portal-response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission("ledger.view");
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    const from = query.get("from") ?? "", to = query.get("to") ?? "";
    const { start, endExclusive } = statementPeriod(from, to);
    const account = await db.account.findFirst({
      where: statementAccountScope(id, auth.organisationId, auth.allowedFacilityIds),
      select: { accountNumber: true, currency: true, customer: { select: { firstName: true, lastName: true, companyName: true } }, tenancy: { select: { facility: { select: { name: true } } } }, ledgerEntries: { orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, type: true, amount: true, description: true, effectiveAt: true, reversalOfId: true } } },
    });
    if (!account) return Response.json({ error: { message: "Account not found." } }, { status: 404 });
    const statement = buildAccountStatement(account.ledgerEntries.map(entry => ({ ...entry, amount: entry.amount.toString() })), start, endExclusive);
    if (query.get("format") === "pdf") {
      const bytes = await renderAccountStatementPdf({ ...statement, from, to, generatedAt: new Date().toISOString(), accountNumber: account.accountNumber, currency: account.currency, customerName: account.customer.companyName || [account.customer.firstName, account.customer.lastName].filter(Boolean).join(" "), facilityName: account.tenancy?.facility.name ?? "STOR24" });
      await db.auditEvent.create({ data: { organisationId: auth.organisationId, actorId: auth.user.id, action: "account.statement_downloaded", entityType: "Account", entityId: id } });
      return tenantPdf(bytes, `stor24-statement-${from}-${to}.pdf`);
    }
    return Response.json({ data: { ...statement, from, to, generatedAt: new Date().toISOString(), accountNumber: account.accountNumber, currency: account.currency, customerName: account.customer.companyName || [account.customer.firstName, account.customer.lastName].filter(Boolean).join(" "), facilityName: account.tenancy?.facility.name ?? "STOR24" } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PERIOD") return Response.json({ error: { message: "Choose valid start and end dates, in order." } }, { status: 422 });
    if (error instanceof Error && error.message.startsWith("INVALID_")) return Response.json({ error: { message: "The ledger needs review before a reliable statement can be produced. Please contact your accounts administrator." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
