import { z } from "zod";
import { hasPermission } from "@/lib/permissions";

export type ReportDefinition = {
  key: string;
  name: string;
  group: string;
  description: string;
  permission: string;
  formats: readonly ("CSV" | "JSON")[];
};

export const reportDefinitions: readonly ReportDefinition[] = [
  { key: "occupancy-revenue", name: "Occupancy & revenue", group: "Operations", description: "Physical/economic occupancy, occupied area, revenue and achieved rate.", permission: "reports.view", formats: ["CSV", "JSON"] },
  { key: "unit-availability", name: "Unit availability", group: "Operations", description: "Availability, reservations, service states and short-term forecast.", permission: "reports.view", formats: ["CSV", "JSON"] },
  { key: "move-activity", name: "Move activity", group: "Operations", description: "Move-ins, move-outs, transfers, notices and net rentals.", permission: "reports.view", formats: ["CSV", "JSON"] },
  { key: "lead-conversion", name: "Lead conversion", group: "Sales", description: "Source, stage velocity, conversion and loss reasons.", permission: "reports.sales", formats: ["CSV", "JSON"] },
  { key: "rent-roll", name: "Rent roll & tenant ledger", group: "Finance", description: "Rates, balances and account activity.", permission: "reports.financial", formats: ["CSV", "JSON"] },
  { key: "receivables-ageing", name: "Receivables ageing", group: "Finance", description: "Outstanding balances grouped by age and delinquency stage.", permission: "reports.financial", formats: ["CSV", "JSON"] },
  { key: "collections-performance", name: "Collections workload", group: "Collections", description: "Current positive balances and period account activity requiring collections attention.", permission: "reports.collections", formats: ["CSV", "JSON"] },
  { key: "insurance-participation", name: "Insurance participation", group: "Operations", description: "Tenant cover, waivers, snapshotted premiums and outstanding decisions.", permission: "reports.view", formats: ["CSV", "JSON"] },
  { key: "integration-health", name: "Integration health", group: "Integrations", description: "Connection state, failures, webhook backlog and retries.", permission: "integrations.view", formats: ["CSV", "JSON"] },
] as const;

export const reportParametersSchema = z.object({
  reportKey: z.string().trim().min(1),
  facilityId: z.string().trim().min(1).optional(),
  from: z.iso.date(),
  to: z.iso.date(),
  format: z.enum(["CSV", "JSON"]).default("CSV"),
  groupBy: z.enum(["day", "week", "month", "facility"]).default("month"),
}).refine((value) => value.from <= value.to, { message: "From date must be on or before to date.", path: ["from"] });

export type ReportParameters = z.infer<typeof reportParametersSchema>;

export function availableReports(permissions: readonly string[]) {
  return reportDefinitions.filter((report) => hasPermission([...permissions], report.permission));
}
export function findPermittedReport(permissions: readonly string[], key: string) {
  return availableReports(permissions).find((report) => report.key === key);
}

export function toCsv(rows: ReadonlyArray<Record<string, string | number | boolean | null>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const raw = String(value ?? "");
    const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${formulaSafe.replaceAll('"', '""')}"`;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\r\n");
}

