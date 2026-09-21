import { db } from "@/lib/db";

/**
 * Automated recurring monthly rent billing.
 *
 * Scope note: this posts base rent from Occupancy.monthlyRate only. It does
 * NOT read ChargeDefinition (recurring fee templates) or DiscountPlan
 * (discount rules) — those exist in the schema but layering them into the
 * monthly charge amount is explicitly follow-up work, not in scope here.
 */

export type MonthlyBillingSummary = {
  period: string;
  charged: number;
  skipped: number;
  totalAmount: string;
  occupanciesConsidered: number;
};

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function billingExternalRef(period: string) {
  return `RENT-${period}`;
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

/**
 * Idempotently charges one month of rent to every actively-occupied unit's
 * account. Safe to re-run for the same period any number of times — a
 * period that has already been billed for a given account is skipped, not
 * double-charged.
 *
 * @param period "YYYY-MM", e.g. "2026-08"
 */
export async function runLegacyMonthlyBilling(period: string): Promise<MonthlyBillingSummary> {
  if (!PERIOD_PATTERN.test(period)) throw new Error("INVALID_PERIOD");

  const [year, month] = period.split("-").map(Number);
  const effectiveAt = new Date(Date.UTC(year, month - 1, 1));
  const externalRef = billingExternalRef(period);

  const occupancies = await db.occupancy.findMany({
    where: { status: "ACTIVE", tenancy: { status: "ACTIVE" } },
    include: { tenancy: { include: { account: true } } },
  });

  let charged = 0;
  let skipped = 0;
  let totalAmount = 0;

  for (const occupancy of occupancies) {
    const account = occupancy.tenancy.account;
    if (!account) { skipped++; continue; }

    const alreadyBilled = await db.ledgerEntry.findFirst({ where: { accountId: account.id, externalRef } });
    if (alreadyBilled) { skipped++; continue; }

    try {
      await db.$transaction(async (tx) => {
        await tx.ledgerEntry.create({
          data: {
            accountId: account.id,
            type: "CHARGE",
            amount: occupancy.monthlyRate,
            description: `Monthly rent — ${period}`,
            effectiveAt,
            externalRef,
          },
        });
        await tx.account.update({ where: { id: account.id }, data: { balance: { increment: occupancy.monthlyRate } } });
      });
      charged++;
      totalAmount += Number(occupancy.monthlyRate);
    } catch (error) {
      // Unique (accountId, externalRef) constraint tripped by a concurrent
      // run for the same period — treat as already billed, not a failure.
      if (isUniqueConstraintError(error)) { skipped++; continue; }
      throw error;
    }
  }

  return { period, charged, skipped, totalAmount: totalAmount.toFixed(2), occupanciesConsidered: occupancies.length };
}
