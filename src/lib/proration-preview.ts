/** Local estimate only. Posting uses the approved account billing policy. */
export function prorationPreview(rate: number, date: string) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 10_000_000 || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days) return null;
  const remaining = days - day + 1;
  return { days, remaining, amount: Math.round(Math.round(rate * 100) * remaining / days) / 100, dailyRate: rate / days };
}
