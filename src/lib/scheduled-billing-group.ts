import { createHash } from "node:crypto";

type GroupLine = { accountId: string; organisationId: string; facilityId: string; invoiceId: string | null; externalRef: string; description: string; lineType: string; amount: { toFixed(n: number): string }; taxAmount: { toFixed(n: number): string }; effectiveAt: Date };

export function scheduledBillingGroupHash(lines: GroupLine[]) {
  const values = lines.map(line => ({ accountId: line.accountId, organisationId: line.organisationId, facilityId: line.facilityId, invoiceId: line.invoiceId, externalRef: line.externalRef, description: line.description, lineType: line.lineType, amount: line.amount.toFixed(2), taxAmount: line.taxAmount.toFixed(2), effectiveAt: line.effectiveAt.toISOString() })).sort((a, b) => a.externalRef.localeCompare(b.externalRef, "en"));
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
