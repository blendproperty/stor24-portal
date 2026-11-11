import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { buildAccountStatement } from "@/lib/finance/account-statement";
import { scheduledBillingGroupHash } from "@/lib/scheduled-billing-group";

// Internal primitive only; no production route or scheduler invokes it.
export async function recogniseScheduledBillingCharge(id: string, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("BILLING_RECOGNITION_TIME_INVALID");
  return db.$transaction(async tx => {
    const identity = await tx.scheduledBillingCharge.findUnique({ where: { id }, select: { accountId: true } });
    if (!identity) throw new Error("BILLING_RECOGNITION_NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${identity.accountId} FOR UPDATE`;
    const charge = await tx.scheduledBillingCharge.findUniqueOrThrow({ where: { id } });
    const lines = charge.invoiceId ? await tx.scheduledBillingCharge.findMany({ where: { invoiceId: charge.invoiceId }, orderBy: { externalRef: "asc" } }) : [charge];
    if (charge.invoiceId) {
      const invoice = await tx.document.findUnique({ where: { id: charge.invoiceId }, select: { id: true, type: true, status: true, content: true, sha256: true, tenancy: { select: { accountId: true, facilityId: true } } } });
      if (!invoice?.content || invoice.type !== "INVOICE" || !["GENERATED", "SENT"].includes(invoice.status) || !invoice.sha256 || createHash("sha256").update(invoice.content).digest("hex") !== invoice.sha256 || invoice.tenancy.accountId !== charge.accountId || invoice.tenancy.facilityId !== charge.facilityId || !charge.groupSize || !charge.groupHash || lines.length !== charge.groupSize || lines.some(line => line.accountId !== charge.accountId || line.organisationId !== charge.organisationId || line.facilityId !== charge.facilityId || line.effectiveAt.getTime() !== charge.effectiveAt.getTime() || line.groupSize !== charge.groupSize || line.groupHash !== charge.groupHash) || scheduledBillingGroupHash(lines) !== charge.groupHash) throw new Error("BILLING_RECOGNITION_GROUP_REVIEW");
    }
    if (lines.every(line => line.recognisedAt && line.ledgerEntryId)) {
      const posted = await tx.ledgerEntry.findMany({ where: { id: { in: lines.map(line => line.ledgerEntryId!) } } });
      if (posted.length !== lines.length || lines.some(line => {
        const entry = posted.find(item => item.id === line.ledgerEntryId);
        return !entry || entry.accountId !== line.accountId || entry.externalRef !== line.externalRef || entry.type !== line.lineType || !entry.amount.equals(line.amount) || !entry.taxAmount.equals(line.taxAmount) || entry.effectiveAt.getTime() !== line.effectiveAt.getTime();
      })) throw new Error("BILLING_RECOGNITION_INCONSISTENT");
      return { ledgerEntryId: charge.ledgerEntryId!, alreadyRecognised: true };
    }
    if (lines.some(line => line.recognisedAt || line.ledgerEntryId)) throw new Error("BILLING_RECOGNITION_INCONSISTENT");
    if (lines.some(line => line.effectiveAt > now)) throw new Error("BILLING_RECOGNITION_NOT_DUE");
    const account = await tx.account.findFirst({ where: { id: charge.accountId, customer: { organisationId: charge.organisationId }, tenancy: { facilityId: charge.facilityId, facility: { organisationId: charge.organisationId } } }, select: { balance: true, currency: true } });
    if (!account || account.currency !== "ZAR") throw new Error("BILLING_RECOGNITION_SCOPE_REVIEW");
    const entries = await tx.ledgerEntry.findMany({ where: { accountId: charge.accountId }, orderBy: { id: "asc" } });
    let closing: string;
    try {
      closing = buildAccountStatement(entries.map(entry => ({ ...entry, amount: entry.amount.toString() })), new Date(0), new Date("9999-01-01")).closingBalance;
    } catch {
      throw new Error("BILLING_RECOGNITION_RECONCILIATION");
    }
    if (!account.balance.equals(closing) || entries.some(entry => entry.effectiveAt > now)) throw new Error("BILLING_RECOGNITION_RECONCILIATION");
    let delta = new Prisma.Decimal(0), requestedLedgerId = "";
    for (const line of lines) {
      if (line.lineType !== "CHARGE" && line.lineType !== "CREDIT") throw new Error("BILLING_RECOGNITION_GROUP_REVIEW");
      const entry = await tx.ledgerEntry.create({ data: { accountId: line.accountId, type: line.lineType, amount: line.amount, taxAmount: line.taxAmount, description: line.description, effectiveAt: line.effectiveAt, externalRef: line.externalRef, metadata: { scheduledBillingChargeId: line.id, invoiceId: line.invoiceId } } });
      delta = line.lineType === "CREDIT" ? delta.sub(line.amount) : delta.add(line.amount);
      await tx.scheduledBillingCharge.update({ where: { id: line.id }, data: { recognisedAt: now, ledgerEntryId: entry.id } });
      if (line.id === id) requestedLedgerId = entry.id;
    }
    await tx.account.update({ where: { id: charge.accountId }, data: { balance: { increment: delta } } });
    await tx.auditEvent.create({ data: { organisationId: charge.organisationId, facilityId: charge.facilityId, action: "billing.scheduled_charge_recognised", entityType: "Account", entityId: charge.accountId, after: { invoiceId: charge.invoiceId, scheduledChargeIds: lines.map(line => line.id), effectiveAt: charge.effectiveAt.toISOString(), netAmount: delta.toFixed(2) } } });
    return { ledgerEntryId: requestedLedgerId, alreadyRecognised: false };
  }, { isolationLevel: "Serializable", timeout: 20000 });
}
