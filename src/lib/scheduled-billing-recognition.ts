import { db } from "@/lib/db";
import { buildAccountStatement } from "@/lib/finance/account-statement";

// Internal primitive only. It is not connected to invoicing, a route, or a scheduler.
export async function recogniseScheduledBillingCharge(id: string, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("BILLING_RECOGNITION_TIME_INVALID");
  return db.$transaction(async tx => {
    const identity = await tx.scheduledBillingCharge.findUnique({ where: { id }, select: { accountId: true } });
    if (!identity) throw new Error("BILLING_RECOGNITION_NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${identity.accountId} FOR UPDATE`;
    const charge = await tx.scheduledBillingCharge.findUniqueOrThrow({ where: { id } });
    if (charge.recognisedAt && charge.ledgerEntryId) return { ledgerEntryId: charge.ledgerEntryId, alreadyRecognised: true };
    if (charge.recognisedAt || charge.ledgerEntryId) throw new Error("BILLING_RECOGNITION_INCONSISTENT");
    if (charge.effectiveAt > now) throw new Error("BILLING_RECOGNITION_NOT_DUE");
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
    const entry = await tx.ledgerEntry.create({ data: { accountId: charge.accountId, type: "CHARGE", amount: charge.amount, taxAmount: charge.taxAmount, description: charge.description, effectiveAt: charge.effectiveAt, externalRef: charge.externalRef, metadata: { scheduledBillingChargeId: charge.id } } });
    await tx.account.update({ where: { id: charge.accountId }, data: { balance: { increment: charge.amount } } });
    await tx.scheduledBillingCharge.update({ where: { id }, data: { recognisedAt: now, ledgerEntryId: entry.id } });
    await tx.auditEvent.create({ data: { organisationId: charge.organisationId, facilityId: charge.facilityId, action: "billing.scheduled_charge_recognised", entityType: "Account", entityId: charge.accountId, after: { scheduledChargeId: id, ledgerEntryId: entry.id, effectiveAt: charge.effectiveAt.toISOString(), amount: charge.amount.toFixed(2) } } });
    return { ledgerEntryId: entry.id, alreadyRecognised: false };
  }, { isolationLevel: "Serializable", timeout: 20000 });
}
