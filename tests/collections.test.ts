import assert from "node:assert/strict";
import test from "node:test";
import { ageAccount, csvCell, dateKey, effectiveEntries, promiseProgress, type AgeEntry } from "../src/lib/collections-policy";
const terms = { dueDays: 0, allocation: "OLDEST_DUE_FIRST", approvalReference: "CI approved terms", overrides: [] };
const entry = (id: string, type: string, amount: string, date: string, extra: Partial<AgeEntry> = {}): AgeEntry => ({ id, type, amount, description: id, effectiveAt: new Date(`${date}T00:00:00+02:00`), ...extra });
test("ageing boundaries use SAST days with today still current", () => {
  const days = [0, 1, 30, 31, 60, 61, 90, 91];
  const entries = days.map(n => entry(String(n), "CHARGE", "1", new Date(Date.UTC(2026, 8, 21) - n * 86400000).toISOString().slice(0, 10)));
  const r = ageAccount(entries, "8", "2026-09-21", terms);
  assert.equal(r.issue, null); assert.deepEqual(r.buckets, [100, 200, 200, 200, 100]); assert.equal(r.oldestDays, 91);
  assert.equal(dateKey.safeParse("2026-02-30").success, false);
});
test("source credit reduces newer invoice before oldest-first receipt allocation", () => {
  const entries = [entry("old", "CHARGE", "100", "2026-05-01"), entry("new", "CHARGE", "100", "2026-09-01"), entry("credit", "CREDIT", "50", "2026-09-02", { metadata: { sourceEntryId: "new" } }), entry("paid", "PAYMENT", "75", "2026-09-03")];
  const r = ageAccount(entries, "75", "2026-09-21", terms);
  assert.deepEqual(r.buckets, [0, 5000, 0, 0, 2500]); assert.equal(r.issue, null);
});
test("reversed receipt restores original age and historical view excludes later reversal", () => {
  const entries = [entry("old", "CHARGE", "100", "2026-05-01"), entry("paid", "PAYMENT", "100", "2026-06-01"), entry("undo", "REVERSAL", "100", "2026-09-21", { reversalOfId: "paid" })];
  assert.deepEqual(ageAccount(entries, "100", "2026-09-21", terms).buckets, [0, 0, 0, 0, 10000]);
  assert.equal(ageAccount(entries, "100", "2026-06-20", terms).overdue, 0);
  assert.equal(ageAccount([...entries, entry("redo", "REVERSAL", "100", "2026-09-21", { reversalOfId: "undo" })], "0", "2026-09-21", terms).overdue, 0);
});
test("refund reduces its original receipt; excess credit remains separate", () => {
  const entries = [entry("old", "CHARGE", "100", "2026-05-01"), entry("paid", "PAYMENT", "200", "2026-06-01"), entry("refund", "REFUND", "80", "2026-09-01", { metadata: { sourceEntryId: "paid" } })];
  const r = ageAccount(entries, "-20", "2026-09-21", terms);
  assert.equal(r.credit, 2000); assert.equal(r.overdue, 0); assert.equal(r.issue, null);
  assert.ok(ageAccount([...entries, entry("bad", "REFUND", "130", "2026-09-21", { metadata: { sourceEntryId: "paid" } })], "110", "2026-09-21", terms).issue);
});
test("missing terms, inconsistent balances and unknown sources are held for review", () => {
  const c = entry("charge", "CHARGE", "100", "2026-05-01");
  assert.match(ageAccount([c], "100", "2026-09-21", null).issue!, /terms/);
  assert.match(ageAccount([c], "90", "2026-09-21", terms).issue!, /reconciliation/);
  assert.ok(ageAccount([c, entry("bad", "CREDIT", "1", "2026-09-01", { metadata: { sourceEntryId: "missing" } })], "99", "2026-09-21", terms).issue);
  assert.throws(() => effectiveEntries([entry("bad", "REVERSAL", "1", "2026-09-21", { reversalOfId: "bad" })], "2026-09-21"));
});
test("invoice discount, due-day terms and invoice overrides are deterministic", () => {
  const c = entry("charge", "CHARGE", "100", "2026-09-01", { metadata: { invoiceNumber: "INV-1" } });
  const d = entry("discount", "CREDIT", "10", "2026-09-01", { metadata: { invoiceNumber: "INV-1" } });
  assert.deepEqual(ageAccount([c, d], "90", "2026-09-21", { ...terms, dueDays: 30 }).buckets, [9000, 0, 0, 0, 0]);
  assert.deepEqual(ageAccount([c, d], "90", "2026-09-21", { ...terms, overrides: [{ entryId: "charge", dueDate: "2026-09-20" }] }).buckets, [0, 9000, 0, 0, 0]);
});
test("promise evidence excludes earlier receipts, credits, backdated entries and later refunds", () => {
  const p = { createdAt: new Date("2026-09-10T10:00:00+02:00"), dueDate: "2026-09-15", amount: "100" };
  const entries = [entry("prior", "PAYMENT", "500", "2026-09-01", { createdAt: new Date("2026-09-01") }), entry("credit", "CREDIT", "500", "2026-09-11"), entry("new", "PAYMENT", "100", "2026-09-12", { createdAt: new Date("2026-09-12") }), entry("backdated", "PAYMENT", "500", "2026-09-01", { createdAt: new Date("2026-09-12") })];
  const r = promiseProgress(entries, ["prior", "new", "backdated"], p, "2026-09-21"); assert.equal(r.received, 10000); assert.equal(r.covered, true);
  entries.push(entry("refund", "REFUND", "50", "2026-09-20", { metadata: { sourceEntryId: "new" } }));
  assert.equal(promiseProgress(entries, ["prior", "new"], p, "2026-09-21").covered, false);
  assert.equal(promiseProgress([entry("late", "PAYMENT", "100", "2026-09-16", { createdAt: new Date("2026-09-16") })], ["late"], p, "2026-09-21").label, "Receipts received late");
});
test("CSV quotes cells and neutralises spreadsheet formulas including leading whitespace", () => {
  for (const s of ["=1+1", " +CMD", "-2+3", "@SUM(A1)", "\tformula"]) assert.ok(csvCell(s).startsWith('"\''));
  assert.equal(csvCell('Customer "A", B'), '"Customer ""A"", B"');
});
