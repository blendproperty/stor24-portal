import { createHash } from "node:crypto";
import { z } from "zod";
import { mappingBlockers, mriMappingSchema, MRI_MOVEMENTS, type MriMapping } from "@/lib/mri-mapping-policy";
const key = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/);
const money = z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/);
export const sandboxSourceSchema = z.object({
  origin: z.literal("SANDBOX_MANUAL"), currency: z.literal("ZAR"),
  rows: z.array(z.object({ sourceKey: key, movement: z.enum(MRI_MOVEMENTS), category: z.string().trim().min(1).max(120), amount: money, taxAmount: money, reversalOf: key.nullable() }).strict()).min(1).max(200),
}).strict().superRefine((s, ctx) => {
  if (new Set(s.rows.map(r => r.sourceKey)).size !== s.rows.length) ctx.addIssue({ code: "custom", message: "Source references must be unique." });
});
export type SandboxSource = z.infer<typeof sandboxSourceSchema>;
export const sandboxBatchInput = z.object({ period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/), revision: z.string().uuid().nullable(), source: sandboxSourceSchema }).strict();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const cents = (v: string) => { const [a, b] = v.split("."); return BigInt(a) * BigInt(100) + BigInt(b); };
const display = (v: bigint) => `${v / BigInt(100)}.${String(v % BigInt(100)).padStart(2, "0")}`;
export type JournalLine = { account: string; taxCode: string; debit: string; credit: string };
/** Internal rehearsal format. Deliberately no provider submission contract. */
export function compileSandboxJournal(sourceInput: unknown, mappingInput: unknown) {
  const source = sandboxSourceSchema.parse(sourceInput), mapping = mriMappingSchema.parse(mappingInput);
  const blockers = mappingBlockers(mapping);
  const blocked = () => ({ blockers, lines: [] as JournalLine[], debitTotal: "0.00", creditTotal: "0.00", balanced: false, sourceCount: source.rows.length });
  if (blockers.length) return blocked();
  const individual = new Map<string, Array<{ account: string; taxCode: string; debit: bigint; credit: bigint }>>();
  const reversed = new Set<string>(), ordered = [...source.rows].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  for (const row of ordered.filter(r => r.movement !== "REVERSAL")) {
    const rule = mapping.rules.find(r => r.movement === row.movement && r.category.toLowerCase() === row.category.toLowerCase());
    if (!rule) { blockers.push(`${row.sourceKey}: no explicit sandbox category mapping.`); continue; }
    if (row.reversalOf) { blockers.push(`${row.sourceKey}: only reversals can reference another source.`); continue; }
    const amount = cents(row.amount), tax = cents(row.taxAmount);
    if (!amount || (rule.taxTreatment === "NO_TAX" && tax) || (rule.taxTreatment === "INCLUDED" && tax > amount)) { blockers.push(`${row.sourceKey}: amount or tax conflicts with the mapped treatment.`); continue; }
    const gross = rule.taxTreatment === "EXCLUSIVE" ? amount + tax : amount, net = gross - tax;
    const lines = [
      { account: rule.debitAccount, taxCode: "", debit: rule.taxSide === "DEBIT" ? net : gross, credit: BigInt(0) },
      { account: rule.creditAccount, taxCode: "", debit: BigInt(0), credit: rule.taxSide === "CREDIT" ? net : gross },
    ];
    if (tax) lines.push({ account: rule.taxAccount, taxCode: rule.taxCode, debit: rule.taxSide === "DEBIT" ? tax : BigInt(0), credit: rule.taxSide === "CREDIT" ? tax : BigInt(0) });
    individual.set(row.sourceKey, lines);
  }
  for (const row of ordered.filter(r => r.movement === "REVERSAL")) {
    const original = source.rows.find(r => r.sourceKey === row.reversalOf), lines = row.reversalOf ? individual.get(row.reversalOf) : null;
    if (!original || original.movement === "REVERSAL" || !lines || reversed.has(original.sourceKey) || original.amount !== row.amount || original.taxAmount !== row.taxAmount || original.category.toLowerCase() !== row.category.toLowerCase()) { blockers.push(`${row.sourceKey}: select one unreversed original in this snapshot with identical category, amount and tax.`); continue; }
    reversed.add(original.sourceKey); individual.set(row.sourceKey, lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })));
  }
  if (blockers.length) return blocked();
  const aggregate = new Map<string, { account: string; taxCode: string; debit: bigint; credit: bigint }>();
  for (const lines of individual.values()) for (const line of lines) {
    const k = JSON.stringify([line.account, line.taxCode]), old = aggregate.get(k) ?? { ...line, debit: BigInt(0), credit: BigInt(0) };
    old.debit += line.debit; old.credit += line.credit; aggregate.set(k, old);
  }
  const values = [...aggregate.values()].filter(l => l.debit || l.credit).sort((a, b) => a.account.localeCompare(b.account) || a.taxCode.localeCompare(b.taxCode));
  const debit = values.reduce((a, l) => a + l.debit, BigInt(0)), credit = values.reduce((a, l) => a + l.credit, BigInt(0));
  return { blockers, lines: values.map(l => ({ ...l, debit: display(l.debit), credit: display(l.credit) })), debitTotal: display(debit), creditTotal: display(credit), balanced: debit > BigInt(0) && debit === credit, sourceCount: source.rows.length };
}
export function sandboxJournalCsv(period: string, mapping: MriMapping, preview: ReturnType<typeof compileSandboxJournal>, hash: string) {
  const cell = (v: string) => `"${(/^[\s\uFEFF]*[=+@-]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`;
  const rows = [["SANDBOX REVIEW ONLY - NOT AN MRI IMPORT"], ["Period", period], ["Entity", mapping.entityCode], ["Property", mapping.propertyCode], ["Snapshot hash", hash], ["Account", "Tax code", "Debit ZAR", "Credit ZAR"], ...preview.lines.map(l => [l.account, l.taxCode, l.debit, l.credit]), ["TOTAL", "", preview.debitTotal, preview.creditTotal]];
  return "\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
