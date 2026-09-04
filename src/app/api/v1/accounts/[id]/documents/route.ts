import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { sendBillingDocumentSchema } from "@/lib/validators";
import { sendInvoiceEmail, sendStatementEmail } from "@/lib/finance/billing-documents-service";

export const dynamic = "force-dynamic";

// Staff-triggered "send invoice" / "send statement" action — the ad-hoc
// path from claude/invoicing-statements-scope.md §3.3 (the Stor24 project).
// Deliberately does not accept or construct a Netcash "Pay now" link; see
// billing-documents-service.ts's header comment for why that stays out
// until Pay Now is unblocked for real customers.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const { id: accountId } = await context.params;
    const parsed = sendBillingDocumentSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { message: "Check the request details.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });

    const account = await db.account.findFirst({ where: { id: accountId }, include: { tenancy: { select: { facilityId: true } } } });
    if (!account?.tenancy) return Response.json({ error: { code: "NOT_FOUND", message: "Account not found." } }, { status: 404 });
    const auth = await requirePermission("billing.documents.send", account.tenancy.facilityId);

    const result = parsed.data.documentType === "INVOICE"
      ? await sendInvoiceEmail({ accountId, organisationId: auth.organisationId, ledgerEntryIds: parsed.data.ledgerEntryIds, actorId: auth.user.id })
      : await sendStatementEmail({ accountId, organisationId: auth.organisationId, from: parsed.data.from ? new Date(parsed.data.from) : undefined, to: new Date(parsed.data.to), actorId: auth.user.id });

    if (!result.ok) {
      const status = result.code === "ACCOUNT_NOT_FOUND" ? 404 : result.code === "NO_LEDGER_ENTRIES" ? 422 : result.code === "NO_CUSTOMER_EMAIL" ? 422 : 502;
      const message = {
        ACCOUNT_NOT_FOUND: "Account not found.",
        NO_LEDGER_ENTRIES: "None of the specified ledger entries belong to this account.",
        NO_CUSTOMER_EMAIL: "This customer has no email address on file.",
        EMAIL_FAILED: "The document was generated but could not be emailed.",
      }[result.code];
      return Response.json({ error: { code: result.code, message } }, { status });
    }
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

// List invoices/statements already generated for this account (both
// tracked as `Document` rows against its tenancy) -- the "what was
// actually sent to this customer" view referenced in scope §5.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: accountId } = await context.params;
    const account = await db.account.findFirst({ where: { id: accountId }, include: { tenancy: { select: { id: true, facilityId: true } } } });
    if (!account?.tenancy) return Response.json({ error: { code: "NOT_FOUND", message: "Account not found." } }, { status: 404 });
    await requirePermission("ledger.view", account.tenancy.facilityId);
    const documents = await db.document.findMany({
      where: { tenancyId: account.tenancy.id, type: { in: ["INVOICE", "STATEMENT"] } },
      select: { id: true, type: true, status: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return Response.json({ data: { documents } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
