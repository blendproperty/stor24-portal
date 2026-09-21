import { z } from "zod";
import { statementPeriod, type StatementEntry } from "@/lib/finance/account-statement";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export const dateKey = z.string().refine(v => { try { statementPeriod(v, v); return true; } catch { return false; } }, "Use a valid date.");
export const termsSchema = z.object({ dueDays: z.number().int().min(0).max(120), allocation: z.literal("OLDEST_DUE_FIRST"), approvalReference: z.string().trim().min(5).max(200), overrides: z.array(z.object({ entryId: z.string(), dueDate: dateKey })).max(500).default([]) }).strict();
export type CollectionTerms = z.infer<typeof termsSchema>;
export const buckets = ["Current", "1–30 days", "31–60 days", "61–90 days", "91+ days"] as const;
export type AgeEntry = StatementEntry & { metadata?: unknown; createdAt?: Date };
export const moneyCents = (value: string) => { const n = Math.round(Number(value) * 100); if (!Number.isSafeInteger(n)) throw new Error("COLLECTION_REVIEW"); return n; };
const day = (value: string) => statementPeriod(value, value).start.getTime() / 86400000;
const meta = (e: AgeEntry) => (e.metadata ?? {}) as { sourceEntryId?: string; invoiceNumber?: string };

/** Collapse reversals onto their original source, retaining that source's original age. */
export function effectiveEntries(entries: AgeEntry[], asOf: string) {
  dateKey.parse(asOf);
  const all = new Map(entries.map(e => [e.id, e]));
  if (all.size !== entries.length) throw new Error("COLLECTION_REVIEW");
  const values = new Map<string, { entry: AgeEntry; amount: number }>();
  for (const e of entries) {
    if (southAfricaDateKey(e.effectiveAt) > asOf) continue;
    const amount = moneyCents(e.amount);
    if (amount < 0) throw new Error("COLLECTION_REVIEW");
    let root = e, sign = 1;
    const seen = new Set<string>();
    while (root.type === "REVERSAL") {
      if (seen.has(root.id)) throw new Error("COLLECTION_REVIEW");
      seen.add(root.id);
      const source = root.reversalOfId ? all.get(root.reversalOfId) : undefined;
      if (!source || source.effectiveAt > root.effectiveAt || moneyCents(root.amount) > moneyCents(source.amount)) throw new Error("COLLECTION_REVIEW");
      root = source; sign *= -1;
    }
    if (!["CHARGE", "PAYMENT", "CREDIT", "WRITE_OFF", "REFUND"].includes(root.type)) throw new Error("COLLECTION_REVIEW");
    const item = values.get(root.id) ?? { entry: root, amount: 0 };
    item.amount += sign * amount; values.set(root.id, item);
  }
  for (const v of values.values()) if (v.amount < 0 || v.amount > moneyCents(v.entry.amount)) throw new Error("COLLECTION_REVIEW");
  return [...values.values()];
}
export function ageAccount(entries: AgeEntry[], currentBalance: string, asOf: string, rawTerms: unknown) {
  const empty = { buckets: [0, 0, 0, 0, 0], overdue: 0, credit: 0, balance: 0, oldestDays: 0, charges: [] as { id: string; description: string; dueDate: string; remaining: number; days: number }[] };
  try {
    const all = effectiveEntries(entries, "9998-12-31");
    const net = (values: typeof all) => values.reduce((s, v) => s + (["CHARGE", "REFUND"].includes(v.entry.type) ? v.amount : -v.amount), 0);
    if (net(all) !== moneyCents(currentBalance)) return { ...empty, issue: "Ledger and account balance need reconciliation." };
    const values = effectiveEntries(entries, asOf), balance = net(values);
    const terms = termsSchema.safeParse(rawTerms);
    if (!terms.success && values.some(v => v.entry.type === "CHARGE" && v.amount > 0)) return { ...empty, balance, issue: "Approved due dates and allocation terms are missing." };
    const charges = values.filter(v => v.entry.type === "CHARGE").map(v => {
      const date = southAfricaDateKey(v.entry.effectiveAt), override = terms.success ? terms.data.overrides.find(o => o.entryId === v.entry.id) : undefined;
      const dueDate = override?.dueDate ?? southAfricaDateKey(new Date(statementPeriod(date, date).start.getTime() + (terms.success ? terms.data.dueDays : 0) * 86400000));
      if (dueDate < date) throw new Error("COLLECTION_REVIEW");
      return { id: v.entry.id, description: v.entry.description, dueDate, remaining: v.amount, days: day(asOf) - day(dueDate), invoice: meta(v.entry).invoiceNumber };
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    let credit = 0;
    const consume = (amount: number, targets: typeof charges) => { for (const c of targets) { const used = Math.min(amount, c.remaining); c.remaining -= used; amount -= used; } return amount; };
    // Source-linked corrections must reduce their own invoice before allocating receipts.
    for (const v of values.filter(v => ["CREDIT", "WRITE_OFF"].includes(v.entry.type))) {
      const m = meta(v.entry);
      if (m.sourceEntryId || m.invoiceNumber) {
        const targets = charges.filter(c => m.sourceEntryId ? c.id === m.sourceEntryId : c.invoice === m.invoiceNumber);
        if (!targets.length || consume(v.amount, targets) > 0) throw new Error("COLLECTION_REVIEW");
      } else credit += v.amount;
    }
    const payments = new Map(values.filter(v => v.entry.type === "PAYMENT").map(v => [v.entry.id, v.amount]));
    for (const v of values.filter(v => v.entry.type === "REFUND")) {
      const source = meta(v.entry).sourceEntryId, available = source ? payments.get(source) : undefined;
      if (available === undefined || available < v.amount) throw new Error("COLLECTION_REVIEW");
      payments.set(source!, available - v.amount);
    }
    credit += [...payments.values()].reduce((s, n) => s + n, 0);
    credit = consume(credit, charges);
    const totals = [0, 0, 0, 0, 0]; let oldestDays = 0;
    for (const c of charges) { const i = c.days <= 0 ? 0 : c.days <= 30 ? 1 : c.days <= 60 ? 2 : c.days <= 90 ? 3 : 4; totals[i] += c.remaining; if (c.remaining) oldestDays = Math.max(oldestDays, c.days); }
    if (totals.reduce((s, n) => s + n, 0) - credit !== balance) throw new Error("COLLECTION_REVIEW");
    return { buckets: totals, overdue: totals.slice(1).reduce((s, n) => s + n, 0), credit, balance, oldestDays, charges: charges.map(c => ({ id: c.id, description: c.description, dueDate: c.dueDate, remaining: c.remaining, days: c.days })), issue: null };
  } catch { return { ...empty, issue: "Unsupported or inconsistent ledger history needs finance review." }; }
}

/** Only newly recorded, verified receipts count; credits/write-offs cannot fulfil a promise. */
export function promiseProgress(entries: AgeEntry[], verifiedReceiptIds: string[], promise: { createdAt: Date; dueDate: string; amount: string }, asOf: string) {
  const values = effectiveEntries(entries, asOf);
  let received = 0, onTime = 0;
  for (const v of values.filter(v => v.entry.type === "PAYMENT" && verifiedReceiptIds.includes(v.entry.id))) {
    if (!v.entry.createdAt || v.entry.createdAt <= promise.createdAt || v.entry.effectiveAt < promise.createdAt) continue;
    const refund = values.filter(r => r.entry.type === "REFUND" && meta(r.entry).sourceEntryId === v.entry.id).reduce((s, r) => s + r.amount, 0);
    const amount = Math.max(0, v.amount - refund); received += amount;
    if (southAfricaDateKey(v.entry.effectiveAt) <= promise.dueDate) onTime += amount;
  }
  const target = moneyCents(promise.amount);
  return { received, onTime, label: onTime >= target ? "Receipts cover promise" : received >= target ? "Receipts received late" : asOf > promise.dueDate ? "Promise overdue" : received ? "Part payment received" : "Awaiting receipt", covered: onTime >= target };
}
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${(/^[\s]*[=+\-@\t\r\n]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}

const base = { accountId: z.string().cuid(), revision: z.number().int().min(0), requestKey: z.string().uuid(), note: z.string().trim().min(5).max(1000) };
export const collectionActionSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("terms"), terms: termsSchema, confirm: z.literal(true) }).strict(),
  z.object({ ...base, action: z.literal("follow-up"), ownerId: z.string().cuid().nullable(), nextFollowUp: dateKey.nullable(), outcome: z.enum(["PLAN", "REACHED", "NO_ANSWER"]) }).strict(),
  z.object({ ...base, action: z.literal("dispute"), disputed: z.boolean() }).strict(),
  z.object({ ...base, action: z.literal("promise"), amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).refine(v => Number(v) > 0), dueDate: dateKey, confirm: z.literal(true) }).strict(),
  z.object({ ...base, action: z.literal("close-promise"), promiseId: z.string().cuid(), status: z.enum(["KEPT", "CANCELLED"]) }).strict(),
]);
export type CollectionAction = z.infer<typeof collectionActionSchema>;
