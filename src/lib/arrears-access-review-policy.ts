import { statementPeriod } from "@/lib/finance/account-statement";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export const ARREARS_REVIEW_POLICY = "2026-10-18-seven-calendar-days-v1";
type Charge = { id: string; dueDate: string; remaining: number };
type Input = { asOf: string; paymentMethod: string | null; active: boolean; issue: string | null; hold: string | null; charges: Charge[] };

/** Internal review eligibility only: never a financial or physical-access instruction. */
export function arrearsAccessReview(input: Input) {
  const day = (date: string) => statementPeriod(date, date).start.getTime();
  const asOf = day(input.asOf);
  const charges = input.charges.filter(c => c.remaining > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const oldest = charges[0];
  const blockers: string[] = [];
  if (!input.active) blockers.push("Only an active tenancy can enter this review workflow.");
  if (input.issue) blockers.push(input.issue);
  if (input.hold) blockers.push(input.hold);
  if (input.paymentMethod === "DEBIT_ORDER") blockers.push("Seven calendar days must start at an authoritative confirmed debit failure. Final failure-to-debt evidence is not yet available in this workflow; no due-date fallback is permitted.");
  else if (!["EFT", "CARD"].includes(input.paymentMethod ?? "")) blockers.push("The current agreement payment method needs review.");
  if (!oldest) blockers.push("There is no reconciled outstanding charge to review.");
  const reviewDate = oldest && ["EFT", "CARD"].includes(input.paymentMethod ?? "") ? southAfricaDateKey(new Date(day(oldest.dueDate) + 7 * 86_400_000)) : null;
  if (reviewDate && asOf < day(reviewDate)) blockers.push(`Seven calendar days have not elapsed. Review is due ${reviewDate}.`);
  return { policy: ARREARS_REVIEW_POLICY, paymentMethod: input.paymentMethod, reviewOn: reviewDate, sourceChargeId: oldest?.id ?? null, blockers, eligible: blockers.length === 0, financialApproval: false, accessApproval: false };
}
