// Estimate the rent difference against a full original month, using the same
// separate actual-day rounding as monthly billing. No ledger entry is posted.
export function transferRentPreview(date: string, oldRate: string, newRate: string) {
  const match = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(date);
  if (!match || !/^\d+(?:\.\d{1,2})?$/.test(oldRate) || !/^\d+(?:\.\d{1,2})?$/.test(newRate)) return null;
  const [, year, month, dayText] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const day = Number(dayText);
  const oldCents = Math.round(Number(oldRate) * 100), newCents = Math.round(Number(newRate) * 100);
  if (day > days || !Number.isSafeInteger(oldCents) || !Number.isSafeInteger(newCents) || oldCents > 1000000000 || newCents > 1000000000) return null;
  const newDays = days - day + 1;
  const revisedCents = Math.round(oldCents * (day - 1) / days) + Math.round(newCents * newDays / days);
  return { days, newDays, difference: (revisedCents - oldCents) / 100 };
}
