import { db } from "@/lib/db";
import { requirePermissionScope, facilityWhere } from "@/lib/scope";
import { authErrorResponse } from "@/lib/auth-guards";
import { receiptAllocationGraph } from "@/lib/receipt-reallocation-source";
import { documentShellHtml, escapeHtml, formatZar } from "@/lib/finance/billing-document-brand";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { Prisma } from "@/generated/prisma/client";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";

export async function GET(_request: Request, context: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const scope = await requirePermissionScope("ledger.view");
    const { id, paymentId } = await context.params;
    const html = await db.$transaction(async tx => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId, accountId: id, account: { customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(scope) } } },
        select: { status: true, method: true, providerRef: true, account: { select: { accountNumber: true, customer: { select: { firstName: true, lastName: true, companyName: true } }, tenancy: { select: { facility: { select: { name: true } } } } } } } });
      if (!payment) throw Error("RECEIPT_NOT_FOUND");
      const evidence = await receiptAllocationGraph(tx, scope, paymentId);
      if (payment.status !== "SUCCEEDED" || evidence.accounts.some(a => a.inFlight)) throw Error("RECEIPT_REVIEW");
      const customer = payment.account.customer;
      const rows = [["Receipt reference", paymentId], ["Customer", customer.companyName || [customer.firstName,customer.lastName].filter(Boolean).join(" ")], ["Account", payment.account.accountNumber], ["Store", payment.account.tenancy!.facility.name], ["Received", formatSouthAfricaDate(evidence.receivedAt)], ["Amount received", formatZar(evidence.root.amount)], ["Method", payment.method.replaceAll("_"," ")], ["Payment reference", payment.providerRef || "Not recorded"]];
      return documentShellHtml({ title: "STOR24 payment receipt", preheader: "Copy of a verified posted receipt", bodyHtml: `<h1>Payment receipt</h1><p>Copy of the original posted receipt. Use your browser's Print command to print or save a PDF.</p><dl>${rows.map(([label,value])=>`<dt><strong>${escapeHtml(label)}</strong></dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`, footerNote: "This records the original amount received. Later allocations, refunds and current balances must be checked in the account ledger. It does not confirm a paid-through date." });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
    const response = await protectDlpResponse(new Response(html, { headers: { "Content-Type":"text/html; charset=utf-8", "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } }), { organisationId: scope.organisationId, actorId: scope.userId, resourceId: paymentId });
    await db.auditEvent.create({data:{organisationId:scope.organisationId,actorId:scope.userId,action:"account.receipt_viewed",entityType:"Payment",entityId:paymentId,after:{accountId:id}}});
    return response;
  } catch(error) {
    const message = error instanceof Error ? error.message : "";
    if (["RECEIPT_NOT_FOUND","REALLOCATION_NOT_FOUND"].includes(message)) return Response.json({error:{message:"Receipt not found in your permitted account."}},{status:404,headers:{"Cache-Control":"private, no-store"}});
    if (message === "RECEIPT_REVIEW" || message.startsWith("REALLOCATION_")) return Response.json({error:{message:"This receipt needs financial review before a copy can be issued."}},{status:409,headers:{"Cache-Control":"private, no-store"}});
    return authErrorResponse(error);
  }
}
