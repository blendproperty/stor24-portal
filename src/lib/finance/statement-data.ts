import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { buildAccountStatement, statementPeriod } from "@/lib/finance/account-statement";

export async function getStatementData(where: Prisma.AccountWhereInput, from: string, to: string) {
  const { start, endExclusive } = statementPeriod(from, to);
  const account = await db.account.findFirst({ where, select: {
    id: true, accountNumber: true, currency: true,
    customer: { select: { firstName: true, lastName: true, companyName: true } },
    tenancy: { select: { facility: { select: { name: true } } } },
    ledgerEntries: { orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, type: true, amount: true, description: true, effectiveAt: true, reversalOfId: true } },
  } });
  if (!account) throw new Error("TENANT_NOT_FOUND");
  return { ...buildAccountStatement(account.ledgerEntries.map(entry => ({ ...entry, amount: entry.amount.toString() })), start, endExclusive),
    from, to, generatedAt: new Date().toISOString(), accountNumber: account.accountNumber, currency: account.currency,
    customerName: account.customer.companyName || [account.customer.firstName, account.customer.lastName].filter(Boolean).join(" "), facilityName: account.tenancy?.facility.name ?? "STOR24" };
}

export type AccountStatementData = Awaited<ReturnType<typeof getStatementData>>;
