import { ReportError, REPORT_SOURCE_LIMIT } from "./visual-report-engine";
import { southAfricaDateKey } from "./south-africa-time";
import type { VisualReportRow } from "./visual-report-contract";

export type NativeUnpaidAccount = {
  accountNumber: string; name: string; facility: string; hold: string | null;
  ageing: { issue: string | null; charges: { id: string; description: string; dueDate: string; remaining: number; days: number }[] };
  sources: { id: string; date: string }[];
};

/** Use the collections service's approved allocations and quarantine; never allocate again here. */
export function nativeUnpaidRows(accounts: NativeUnpaidAccount[], asOf: string, totalingMoney = false, now = new Date()): VisualReportRow[] {
  if (asOf > southAfricaDateKey(now)) throw new ReportError("REPORT_ASOF_FUTURE");
  if (totalingMoney && accounts.some(a => a.ageing.issue)) throw new ReportError("REPORT_FINANCE_REVIEW_REQUIRED");
  const rows: VisualReportRow[] = [];
  for (const account of accounts) {
    const base = { facility: account.facility, account: account.accountNumber, customer: account.name, asOf, hold: account.hold };
    if (account.ageing.issue) {
      rows.push({ ...base, charge: null, description: null, chargeDate: null, due: null, amount: null, daysLate: null, currency: null, review: account.ageing.issue });
    } else for (const charge of account.ageing.charges) {
      if (!Number.isSafeInteger(charge.remaining) || charge.remaining < 0) throw new ReportError("INVALID_REPORT_AMOUNT");
      if (!charge.remaining) continue;
      const cents = BigInt(charge.remaining);
      rows.push({ ...base, charge: charge.id, description: charge.description, chargeDate: account.sources.find(s => s.id === charge.id)?.date ?? null, due: charge.dueDate,
        amount: `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`, daysLate: Math.max(0, charge.days), currency: "ZAR", review: null });
    }
    if (rows.length > REPORT_SOURCE_LIMIT) throw new ReportError("REPORT_LIMIT");
  }
  return rows;
}
