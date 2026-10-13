import assert from "node:assert/strict";
import test from "node:test";
import { emptyMriMapping, type MriMapping } from "../src/lib/mri-mapping-policy";
import { compileSandboxJournal, fingerprint, sandboxSourceSchema, sandboxJournalCsv, type SandboxSource } from "../src/lib/mri-batch-policy";
const mapping = (): MriMapping => ({ ...emptyMriMapping(), entityCode: "TEST", propertyCode: "TEST", basis: "ACCRUAL" as const, scopeNotes: "Synthetic test only", rules: emptyMriMapping().rules.map(r => ({ ...r, debitAccount: "TEST-DR", creditAccount: "TEST-CR", taxTreatment: "NO_TAX" as const, rationale: "Synthetic category and sign instructions" })) });
const source = (): SandboxSource => ({ origin: "SANDBOX_MANUAL", currency: "ZAR", rows: [{ sourceKey: "test-a", movement: "CHARGE", category: "charge", amount: "115.00", taxAmount: "15.00", reversalOf: null }] });
test("included and additional tax balance exactly on the explicitly selected side", () => {
  const m = mapping(); m.rules[0] = { ...m.rules[0], taxTreatment: "INCLUDED", taxSide: "CREDIT", taxAccount: "TEST-TAX", taxCode: "TEST-VAT" };
  const p = compileSandboxJournal(source(), m); assert.equal(p.balanced, true); assert.equal(p.debitTotal, "115.00"); assert.equal(p.lines.find(l => l.account === "TEST-CR")?.credit, "100.00"); assert.equal(p.lines.find(l => l.account === "TEST-TAX")?.credit, "15.00");
  m.rules[0] = { ...m.rules[0], taxTreatment: "EXCLUSIVE", taxSide: "DEBIT" };
  const additional = compileSandboxJournal(source(), m); assert.equal(additional.debitTotal, "130.00"); assert.equal(additional.creditTotal, "130.00"); assert.equal(additional.lines.find(l => l.account === "TEST-DR")?.debit, "115.00"); assert.equal(additional.lines.find(l => l.account === "TEST-TAX")?.debit, "15.00");
});
test("exact cents and consolidated accounting never round binary floats", () => {
  const s = source(); s.rows = ["0.10", "0.20"].map((amount, i) => ({ ...s.rows[0], sourceKey: `c${i}`, amount, taxAmount: "0.00" }));
  const p = compileSandboxJournal(s, mapping()); assert.equal(p.debitTotal, "0.30"); assert.equal(p.creditTotal, "0.30");
});
test("snapshot fingerprints survive JSON field ordering and detect source corrections", () => {
  assert.equal(fingerprint({a:1,b:{x:2,y:3}}),fingerprint({b:{y:3,x:2},a:1}));assert.notEqual(fingerprint({a:"1.00"}),fingerprint({a:"1.01"}));
});
test("taxable reversals mirror the original tax accounts rather than a guessed reversal GL", () => {
  const m=mapping();m.rules[0]={...m.rules[0],taxTreatment:"INCLUDED",taxSide:"CREDIT",taxAccount:"TEST-TAX",taxCode:"TEST-VAT"}; const s=source();s.rows.push({...s.rows[0],sourceKey:"rev",movement:"REVERSAL",reversalOf:"test-a"});const p=compileSandboxJournal(s,m);
  assert.equal(p.balanced,true);assert.equal(p.lines.find(l=>l.account==="TEST-TAX")?.debit,"15.00");assert.equal(p.lines.find(l=>l.account==="TEST-TAX")?.credit,"15.00");
});
test("full reversal uses original tax/account direction and rejects double, partial or cross-snapshot reversals", () => {
  const s = source(); s.rows[0].taxAmount = "0.00"; s.rows.push({ ...s.rows[0], sourceKey: "rev-a", movement: "REVERSAL", reversalOf: "test-a" });
  const p = compileSandboxJournal(s, mapping()); assert.equal(p.balanced, true); assert.equal(p.debitTotal, "230.00");
  s.rows.push({ ...s.rows[1], sourceKey: "rev-b" }); assert.ok(compileSandboxJournal(s, mapping()).blockers.length);
  s.rows.pop(); s.rows[1].amount = "10.00"; assert.ok(compileSandboxJournal(s, mapping()).blockers.length);
  s.rows[1].amount = "115.00"; s.rows[1].reversalOf = "unknown"; assert.ok(compileSandboxJournal(s, mapping()).blockers.length);
});
test("unclassified, zero, invalid tax or missing mapping decisions cannot produce partial journals", () => {
  const s = source(); assert.equal(compileSandboxJournal(s, mapping()).balanced, false);
  s.rows[0].taxAmount = "0.00"; s.rows[0].category = "deposit-needs-explicit-rule"; assert.equal(compileSandboxJournal(s, mapping()).lines.length, 0);
  s.rows[0].category = "charge"; s.rows[0].amount = "0.00"; assert.equal(compileSandboxJournal(s, mapping()).balanced, false);
  assert.equal(compileSandboxJournal(s, emptyMriMapping()).balanced, false);
});
test("source schema cannot import live-origin data, other currency, duplicate references or sub-cent values", () => {
  const s = source();
  for (const input of [{...s,origin:"LIVE_LEDGER"},{...s,currency:"USD"},{...s,rows:[s.rows[0],s.rows[0]]},{...s,rows:[{...s.rows[0],amount:"1.001"}]}]) assert.equal(sandboxSourceSchema.safeParse(input).success,false);
});
test("review CSV carries sandbox/hash/total evidence and protects formula-like accounts", () => {
  const m = mapping(); m.entityCode = "=danger"; const s = source(); s.rows[0].taxAmount = "0.00";
  const csv = sandboxJournalCsv("2026-01", m, compileSandboxJournal(s,m), "a".repeat(64)); assert.ok(csv.includes("NOT AN MRI IMPORT")); assert.ok(csv.includes('"\'=danger"')); assert.ok(csv.includes('"TOTAL","","115.00","115.00"'));
});
