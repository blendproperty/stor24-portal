import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

// This is a preparation contract owned by STOR24, not an MRI journal payload.
export const mriSettingsSchema = z.object({
  revision: z.string().datetime().nullable(),
  databaseLabel: z.string().trim().min(1).max(100),
  environment: z.enum(["unknown", "test", "live"]),
  login: z.string().trim().max(254).optional(),
  password: z.string().max(1000).optional(),
  databaseIdentifier: z.string().trim().max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.login) !== Boolean(value.password)) ctx.addIssue({ code: "custom", message: "Replace the login and password together." });
});

export function mriMonthRange(month: string, now = new Date()) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("MRI_MONTH");
  const start = new Date(`${month}-01T00:00:00+02:00`);
  if (start > now) throw new Error("MRI_MONTH");
  const [year, number] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, number, 1, -2));
  return { start, end, partial: end > now };
}

export type MriSourceRow = {
  id: string; accountId: string; facilityId: string | null; facilityName: string | null;
  type: string; amount: string; taxAmount: string; effectiveAt: string;
};

export function summariseMriSource(rows: MriSourceRow[], quarantinedAccounts: Set<string>) {
  const groups = new Map<string, { facility: string; type: string; count: number; amount: Prisma.Decimal; tax: Prisma.Decimal }>();
  let excluded = 0, unassigned = 0;
  for (const row of rows) {
    if (quarantinedAccounts.has(row.accountId)) { excluded++; continue; }
    if (!row.facilityId) unassigned++;
    const key = JSON.stringify([row.facilityId, row.type]);
    const group = groups.get(key) ?? { facility: row.facilityName ?? "Unassigned store", type: row.type, count: 0, amount: new Prisma.Decimal(0), tax: new Prisma.Decimal(0) };
    group.count++; group.amount = group.amount.add(row.amount); group.tax = group.tax.add(row.taxAmount);
    groups.set(key, group);
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
    quarantinedAccounts: [...quarantinedAccounts].sort(),
  })).digest("hex");
  return {
    rowCount: rows.length, excluded, unassigned, fingerprint,
    groups: [...groups.values()].sort((a, b) => a.facility.localeCompare(b.facility) || a.type.localeCompare(b.type)).map(g => ({ ...g, amount: g.amount.toFixed(2), tax: g.tax.toFixed(2) })),
  };
}
