export const rentalDurations = ["ONE_MONTH", "TWO_TO_THREE_MONTHS", "FOUR_TO_SIX_MONTHS", "LONGER", "UNSURE"] as const;
export type RentalDuration = typeof rentalDurations[number];
export function readRentalPlan(value: unknown) {
  const plan = value as { expectedDuration?: unknown; futurePaymentMethod?: unknown; choiceAt?: unknown } | null;
  return {
    expectedDuration: rentalDurations.includes(plan?.expectedDuration as RentalDuration) ? plan!.expectedDuration as RentalDuration : "UNSURE" as RentalDuration,
    futurePaymentMethod: plan?.futurePaymentMethod === "DEBIT_ORDER" || plan?.futurePaymentMethod === "MANUAL" ? plan.futurePaymentMethod : null,
    choiceAt: typeof plan?.choiceAt === "string" ? plan.choiceAt : null,
  };
}
export function monthlyPaymentsRelevant(value: unknown) { return readRentalPlan(value).expectedDuration !== "ONE_MONTH"; }
