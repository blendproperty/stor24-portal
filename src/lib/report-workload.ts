/** Refuse an oversized report in full; never return a plausible partial export. */
export const MAX_REPORT_ROWS = 10_000;
export const REPORT_QUERY_TAKE = MAX_REPORT_ROWS + 1;
export const MAX_REPORT_PERIOD_DAYS = 366;
export function requireReportCapacity(rows: readonly unknown[]) {
  if (rows.length > MAX_REPORT_ROWS) throw new Error("REPORT_LIMIT");
}
export function reportPeriodAllowed(reportKey: string, from: string, to: string) {
  // These reports are current snapshots or all-history ageing, not period exports.
  if (["occupancy-revenue", "unit-availability", "integration-health", "receivables-ageing", "insurance-participation"].includes(reportKey)) return true;
  return Date.parse(to) - Date.parse(from) < MAX_REPORT_PERIOD_DAYS * 86400000;
}
