import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { billingPeriodSchema, billingPlanSchema, nextBillingPeriod } from "@/lib/monthly-billing-policy";
import { previewMonthlyBillingInTransaction } from "@/lib/monthly-billing-service";
import { Prisma } from "@/generated/prisma/client";
import { getBillingDocumentCompanyDetails } from "@/lib/finance/billing-document-config";
import { renderInvoiceHtml } from "@/lib/finance/invoice-renderer";
import { scheduledInvoiceDate } from "@/lib/invoice-schedule";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { periodDates } from "@/lib/monthly-billing-policy";

export const combinedPreviewInput = z.object({ customerId: z.string().cuid(), facilityId: z.string().cuid(), period: billingPeriodSchema }).strict();

async function snapshot(tx: Prisma.TransactionClient, scope: RequestScope, input: z.infer<typeof combinedPreviewInput>, scheduled = false) {
  const accounts = await tx.account.findMany({
    where: { customerId: input.customerId, customer: { organisationId: scope.organisationId }, tenancy: { facilityId: input.facilityId, facility: facilityWhere(scope), status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } },
    select: { id: true, accountNumber: true, tenancy: { select: { id: true, status: true } } }, orderBy: { id: "asc" }, take: 21,
  });
  if (accounts.length < 2) throw new Error("COMBINED_REQUIRES_TWO_ACCOUNTS");
  if (accounts.length > 20) throw new Error("COMBINED_TOO_MANY_ACCOUNTS");
  // Notice eligibility is not settled; do not silently exclude an account.
  if (accounts.some(account => account.tenancy?.status === "NOTICE_GIVEN")) throw new Error("COMBINED_NOTICE_REVIEW");
  const tenancyIds = accounts.map(account => account.tenancy!.id);
  const handovers = await tx.auditEvent.findMany({ where: { organisationId: scope.organisationId, facilityId: input.facilityId, entityType: "Tenancy", entityId: { in: tenancyIds }, action: "tenancy.key_handover_confirmed" }, select: { entityId: true } });
  if (tenancyIds.some(id => !handovers.some(event => event.entityId === id))) throw new Error("COMBINED_HANDOVER_REVIEW");
  const bills = [];
  for (const account of accounts) {
    if (scheduled) {
      const profile = await tx.configurationProfile.findFirst({where:{organisationId:scope.organisationId,facilityId:input.facilityId,domain:"MONTHLY_BILLING",name:account.id,status:"READY"}});
      const discount = profile ? billingPlanSchema.parse(profile.config).discount : null;
      if (discount && input.period >= discount.startsPeriod && input.period <= discount.endsPeriod) throw new Error("BILLING_DISCOUNT_POLICY_REVIEW");
    }
    bills.push(await previewMonthlyBillingInTransaction(tx, scope, account.id, input.period, scheduled ? nextBillingPeriod() : undefined));
  }
  const totalCents = bills.reduce((sum, bill) => sum + Math.round(bill.total * 100), 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error("COMBINED_AMOUNT_INVALID");
  const company = await getBillingDocumentCompanyDetails(scope.organisationId, input.facilityId, tx);
  return { period: input.period, customerId: input.customerId, facilityId: input.facilityId, accounts: bills, total: totalCents / 100,
    fingerprint: createHash("sha256").update(JSON.stringify({ input, bills: bills.map(bill => [bill.accountId, bill.fingerprint]), company })).digest("hex") };
}

export async function combinedBillingPreview(scope: RequestScope, raw: unknown) {
  const input = combinedPreviewInput.parse(raw);
  return db.$transaction(tx => snapshot(tx, scope, input), { isolationLevel: "RepeatableRead", timeout: 20000 });
}

export async function postCombinedBilling(scope: RequestScope, raw: unknown, fingerprint: string, scheduled = false) {
  const input = combinedPreviewInput.parse(raw);
  return db.$transaction(async tx => {
    // Lock every candidate in a stable order; the serializable transaction also detects concurrent changes to the group.
    const initial = await tx.account.findMany({ where: { customerId: input.customerId, customer: { organisationId: scope.organisationId }, tenancy: { facilityId: input.facilityId, facility: facilityWhere(scope), status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } }, select: { id: true }, orderBy: { id: "asc" }, take: 21 });
    for (const account of initial) await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${account.id} FOR UPDATE`;
    if (scheduled && input.period !== nextBillingPeriod()) throw new Error("BILLING_DRAFT_REVIEW");
    const draft = scheduled ? await tx.configurationProfile.findFirst({where:{organisationId:scope.organisationId,facilityId:input.facilityId,domain:COMBINED_DRAFT,name:draftName(input),status:"READY"}}) : null;
    if (scheduled && (!draft || (draft.config as {fingerprint?:string}).fingerprint !== fingerprint)) throw new Error("BILLING_DRAFT_REVIEW");
    const combined = await snapshot(tx, scope, input, scheduled);
    if (combined.fingerprint !== fingerprint) throw new Error("BILLING_PREVIEW_CHANGED");
    const company = await getBillingDocumentCompanyDetails(scope.organisationId, input.facilityId, tx);
    const invoiceNumber = `INV-${input.period.replace("-", "")}-C-${createHash("sha256").update(`${input.customerId}:${input.facilityId}`).digest("hex").slice(0, 24)}`;
    const lines: Array<{ id: string; description: string; effectiveAt: Date; amount: number; taxAmount: number }> = [];
    let balance = new Prisma.Decimal(0);
    for (const bill of combined.accounts) {
      for (const [index, line] of bill.lines.entries()) {
        const entry = await tx.ledgerEntry.create({ data: { accountId: bill.accountId, type: line.type, amount: line.amount, taxAmount: line.taxAmount, description: line.description, effectiveAt: periodDates(input.period).effectiveAt, externalRef: index === 0 ? `RENT-${input.period}` : `BILL-${input.period}-${line.key}`, createdById: scope.userId, metadata: { billingPeriod: input.period, invoiceNumber, approvalReference: bill.approvalReference, fingerprint: bill.fingerprint, chargeKey: line.key } } });
        lines.push({ id: entry.id, description: `${bill.accountNumber} - ${entry.description}`, effectiveAt: entry.effectiveAt, amount: Number(entry.amount) * (entry.type === "CREDIT" ? -1 : 1), taxAmount: Number(entry.taxAmount) * (entry.type === "CREDIT" ? -1 : 1) });
      }
      const account = await tx.account.update({ where: { id: bill.accountId }, data: { balance: { increment: bill.total } } });
      balance = balance.add(account.balance);
    }
    const first = combined.accounts[0];
    const html = renderInvoiceHtml({ invoiceNumber, issueDate: scheduled ? new Date() : periodDates(input.period).effectiveAt, facilityName: first.facilityName, company, customerName: first.customerName, accountNumber: combined.accounts.map(b => b.accountNumber).join(", "), currentBalance: balance.toString(), lines });
    const sha256 = createHash("sha256").update(html).digest("hex");
    const document = await tx.document.create({ data: { tenancyId: first.tenancyId, type: "INVOICE", status: "GENERATED", storageKey: `inline:${sha256}`, content: html, sha256, externalId: invoiceNumber, idempotencyKey: `combined-invoice:${input.customerId}:${input.facilityId}:${input.period}` } });
    for (const bill of combined.accounts) {
      await tx.combinedInvoiceMembership.create({ data: { accountId: bill.accountId, documentId: document.id, period: input.period } });
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "billing.month_posted", entityType: "Account", entityId: bill.accountId, after: { period: input.period, invoiceNumber, documentId: document.id, total: bill.total, taxTotal: bill.taxTotal, fingerprint } } });
    }
    if (draft) await tx.configurationProfile.update({where:{id:draft.id},data:{status:"POSTED"}});
    return { documentId: document.id, invoiceNumber, total: combined.total };
  }, { isolationLevel: "Serializable", timeout: 30000 });
}

const COMBINED_DRAFT = "NEXT_COMBINED_INVOICE_DRAFT";
const draftName = (input: z.infer<typeof combinedPreviewInput>) => `${input.customerId}:${input.facilityId}:${input.period}`;
export async function prepareScheduledCombined(scope: RequestScope, raw: unknown, now = new Date()) {
  const input = combinedPreviewInput.parse(raw);
  if (process.env.NEXT_MONTH_INVOICING_ENABLED !== "true" || input.period !== nextBillingPeriod(now)) throw new Error("BILLING_SCHEDULE_DISABLED");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${input.facilityId} FOR UPDATE`;
    if (southAfricaDateKey(now) !== await scheduledInvoiceDate(tx,scope.organisationId,input.facilityId,now)) throw new Error("BILLING_SCHEDULE_NOT_DUE");
    const bill = await snapshot(tx,scope,input,true);
    const where={organisationId:scope.organisationId,facilityId:input.facilityId,domain:COMBINED_DRAFT,name:draftName(input)};
    const existing=await tx.configurationProfile.findFirst({where});
    if (existing && (existing.status !== "READY" || (existing.config as {fingerprint?:string}).fingerprint === bill.fingerprint)) throw new Error("BILLING_DRAFT_EXISTS");
    if (existing) await tx.configurationProfile.update({where:{id:existing.id},data:{config:{period:input.period,fingerprint:bill.fingerprint}}});
    else await tx.configurationProfile.create({data:{...where,status:"READY",config:{period:input.period,fingerprint:bill.fingerprint}}});
    return bill;
  },{isolationLevel:"Serializable",timeout:30000});
}
export async function readScheduledCombined(scope: RequestScope, accountId: string) {
  const account=await db.account.findFirst({where:{id:accountId,customer:{organisationId:scope.organisationId},tenancy:{facility:facilityWhere(scope)}},select:{customerId:true,tenancy:{select:{facilityId:true}}}});
  if (!account?.tenancy) throw new Error("BILLING_ACCOUNT_NOT_FOUND");
  const input={customerId:account.customerId,facilityId:account.tenancy.facilityId,period:nextBillingPeriod()};
  return db.$transaction(async tx=>{
    const draft=await tx.configurationProfile.findFirst({where:{organisationId:scope.organisationId,facilityId:input.facilityId,domain:COMBINED_DRAFT,name:draftName(input),status:"READY"}});
    if (!draft) return null;
    const bill=await snapshot(tx,scope,input,true);
    if ((draft.config as {fingerprint?:string}).fingerprint !== bill.fingerprint) throw new Error("BILLING_PREVIEW_CHANGED");
    return bill;
  },{isolationLevel:"RepeatableRead",timeout:30000});
}
