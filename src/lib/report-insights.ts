import type { ReportRow } from "./report-data-service";
export type ReportInsight = {
  metrics: { label: string; value: number; money?: boolean }[];
  bars: { label: string; value: number }[];
  chartTitle: string;
  guidance: string;
};
const number = (value: unknown) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : 0;
export function reportInsights(key: string, rows: ReportRow[]): ReportInsight {
  const sum = (field: string) => rows.reduce((n, r) => n + number(r[field]), 0);
  const groups = (field: string) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const label = String(r[field] ?? "Not recorded");
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return [...map]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  };
  let metrics: ReportInsight["metrics"] = [
      { label: "Records", value: rows.length },
    ],
    bars = groups("facility"),
    chartTitle = "Records by facility",
    guidance =
      "Review the detail below and follow up on exceptions. Empty data is not evidence of a healthy operation.";
  if (key === "occupancy-revenue") {
    metrics = [
      { label: "Units", value: sum("totalUnits") },
      { label: "Occupied", value: sum("occupiedUnits") },
      {
        label: "Contracted monthly rent",
        value: sum("monthlyOccupiedRent"),
        money: true,
      },
      {
        label: "Potential monthly rent",
        value: sum("potentialMonthlyRent"),
        money: true,
      },
    ];
    bars = rows.map((r) => ({
      label: String(r.facility),
      value: number(r.physicalOccupancyPercent),
    }));
    chartTitle = "Physical occupancy (%)";
    guidance =
      "Compare occupied units with contracted rent. Potential rent is capacity, not cash collected; closed floors are shown separately in the detail.";
  }
  if (key === "unit-availability") {
    bars = groups("effectiveStatus");
    chartTitle = "Units by operational status";
    metrics = [
      { label: "Units", value: rows.length },
      {
        label: "Available",
        value: rows.filter((r) => r.effectiveStatus === "AVAILABLE").length,
      },
      {
        label: "Micro ground-floor eligible",
        value: rows.filter(
          (r) =>
            r.microGroundFloorEligible === true,
        ).length,
      },
    ];
    guidance =
      "Use operational status and product eligibility to find bookable space. Review reserved holds and closed floors; eligibility does not release an occupied unit.";
  }
  if (key === "lead-conversion") {
    bars = groups("stage");
    chartTitle = "Enquiries by current stage";
    metrics = [
      { label: "Enquiries created", value: rows.length },
      {
        label: "Micro enquiries",
        value: rows.filter((r) => r.productLine === "MICRO_WAREHOUSE").length,
      },
      {
        label: "Unassigned",
        value: rows.filter((r) => r.assignedTo === "Unassigned").length,
      },
    ];
    guidance =
      "Follow up on unassigned enquiries and compare sources and products. Current-stage counts for leads created in this period are not a historical funnel or verified conversion rate.";
  }
  if (key === "move-activity") {
    bars = groups("status");
    chartTitle = "Occupancy records by status";
    guidance =
      "Review move-in and move-out dates in the selected period. A transfer can create multiple occupancy records; record count is not net new customers.";
  }
  if (key === "rent-roll" || key === "collections-performance") {
    metrics = [
      { label: "Accounts", value: rows.length },
      { label: "Recorded balances", value: sum("balance"), money: true },
      {
        label: "Contracted monthly rent",
        value: sum("monthlyRate"),
        money: true,
      },
    ];
    bars = rows
      .map((r) => ({ label: String(r.account), value: number(r.balance) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    chartTitle = "Largest recorded account balances (R)";
    guidance =
      "Prioritise the largest balances, then reconcile ledger activity and customer disputes. A recorded balance is not a promise of collectible cash.";
  }
  if (key === "receivables-ageing") {
    bars = [
      "current",
      "days1To30",
      "days31To60",
      "days61To90",
      "days91Plus",
    ].map((k) => ({ label: k.replace(/([A-Z])/g, " $1"), value: sum(k) }));
    chartTitle = "Reconciled ageing buckets (R)";
    metrics = [
      { label: "Accounts", value: rows.length },
      { label: "Overdue", value: sum("overdue"), money: true },
      {
        label: "Needs reconciliation",
        value: rows.filter((r) => r.reviewReason).length,
      },
    ];
    guidance =
      "Resolve reconciliation exceptions before collections. Blank ageing values are excluded from totals, not treated as confirmed zero debt.";
  }
  if (key === "insurance-participation") {
    bars = groups("status");
    chartTitle = "Cover decisions by status";
    metrics = [
      { label: "Recorded decisions", value: rows.length },
      { label: "Monthly premiums", value: sum("monthlyPremium"), money: true },
      { label: "Waivers", value: rows.filter((r) => r.waiverReason).length },
    ];
    guidance =
      "Review waivers and unresolved cover decisions. These are recorded enrollments, not proof of insurer acceptance or complete tenant coverage.";
  }
  if (key === "tenant-duration") {
    bars = [
      {
        label: "Under 6 months",
        value: rows.filter((r) => number(r.monthsInUnit) < 6).length,
      },
      {
        label: "6–11 months",
        value: rows.filter(
          (r) => number(r.monthsInUnit) >= 6 && number(r.monthsInUnit) < 12,
        ).length,
      },
      {
        label: "12 months or more",
        value: rows.filter((r) => number(r.monthsInUnit) >= 12).length,
      },
    ];
    chartTitle = "Tenant duration";
    metrics = [
      { label: "Active occupancies", value: rows.length },
      {
        label: "Unknown price-change date",
        value: rows.filter((r) => r.lastPriceChange === null).length,
      },
    ];
    guidance =
      "Review longer tenancies and scheduled changes. Unknown price-change dates remain unknown; a scheduled increase is not proof of a posted invoice.";
  }
  if (key === "integration-health") {
    bars = groups("status");
    chartTitle = "Connections by recorded state";
    metrics = [
      { label: "Connections", value: rows.length },
      { label: "Recorded failures", value: sum("consecutiveFailures") },
    ];
    guidance =
      "Check last health/success timestamps and failure codes. A configured connection or old healthy state does not prove a working customer transaction.";
  }
  return { metrics, bars, chartTitle, guidance };
}
