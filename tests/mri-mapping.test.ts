import assert from "node:assert/strict";
import test from "node:test";
import { emptyMriMapping, mappingBlockers, mappingReviewCsv, mriMappingSchema } from "../src/lib/mri-mapping-policy";

test("finance starts undecided with no invented GL codes or accounting basis", () => {
  const value = emptyMriMapping();
  assert.equal(value.basis, "UNDECIDED"); assert.equal(value.entityCode, "");
  assert.ok(value.rules.every(r => !r.debitAccount && !r.creditAccount && !r.taxAccount && r.taxTreatment === "UNDECIDED"));
  assert.equal(value.rules.length, 6); assert.ok(mappingBlockers(value).length > 10);
});
test("all movement categories, source plan, GL accounts and explicit tax decision required for review", () => {
  const value = emptyMriMapping();
  value.entityCode = "SYNTHETIC"; value.propertyCode = "CI"; value.basis = "ACCRUAL"; value.scopeNotes = "Synthetic ledger only";
  value.rules = value.rules.map(r => ({ ...r, debitAccount: "CI-DEBIT", creditAccount: "CI-CREDIT", taxTreatment: "NO_TAX", rationale: "Synthetic classification, sign and reversal instructions" }));
  assert.deepEqual(mappingBlockers(value), []);
  value.rules[0].taxTreatment = "INCLUDED"; assert.ok(mappingBlockers(value).some(b => b.includes("tax GL")));
  value.rules[0].taxAccount = "CI-TAX"; value.rules[0].taxCode = "CI-TAX-CODE"; assert.deepEqual(mappingBlockers(value), []);
  value.rules[0].creditAccount = "ci-debit"; assert.ok(mappingBlockers(value).some(b => b.includes("must differ")));
  value.rules.pop(); assert.ok(mappingBlockers(value).some(b => b.includes("write off mapping")));
});
test("mapping review CSV labels its limited purpose and escapes formula, quotes and multiline notes", () => {
  const mapping = emptyMriMapping(); mapping.entityCode = '=HYPERLINK("bad")'; mapping.scopeNotes = "line one\nline two";
  mapping.rules[0].rationale = "  @formula";
  const csv = mappingReviewCsv({ mapping, status: "DRAFT", revision: null, approvedAt: null, approvalReference: "\t=other" });
  assert.ok(csv.startsWith("\uFEFF")); assert.ok(csv.includes("NOT an MRI journal import"));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"')); assert.ok(csv.includes('"\'  @formula"')); assert.ok(csv.includes('"\'\t=other"')); assert.ok(csv.includes('"line one\nline two"'));
});
test("bounded strict mapping rejects duplicate categories, invalid movement and unknown posting fields", () => {
  const value = emptyMriMapping();
  assert.ok(mriMappingSchema.safeParse(value).success);
  assert.equal(mriMappingSchema.safeParse({ ...value, postingEnabled: true }).success, false);
  assert.equal(mriMappingSchema.safeParse({ ...value, rules: [...value.rules, { ...value.rules[0], category: " CHARGE " }] }).success, false);
  assert.equal(mriMappingSchema.safeParse({ ...value, rules: [{ ...value.rules[0], movement: "GUESS" }] }).success, false);
  assert.equal(mriMappingSchema.safeParse({ ...value, propertyCode: "CI\nother" }).success, false);
  assert.equal(mriMappingSchema.safeParse({ ...value, rules: Array.from({ length: 61 }, (_, i) => ({ ...value.rules[0], category: String(i) })) }).success, false);
});
