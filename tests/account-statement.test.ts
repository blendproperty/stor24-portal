import test from "node:test";
import assert from "node:assert/strict";
import { buildAccountStatement, statementPeriod, statementAccountScope, type StatementEntry } from "../src/lib/finance/account-statement";

const period = statementPeriod("2026-09-01", "2026-09-30");
test("account scope never drops organisation and empty facility grants match nothing", () => {
  assert.deepEqual(statementAccountScope("a", "org", null), { id: "a", customer: { organisationId: "org" } });
  assert.deepEqual(statementAccountScope("a", "org", []), { id: "a", customer: { organisationId: "org" }, tenancy: { facilityId: { in: [] } } });
  assert.deepEqual(statementAccountScope("a", "org", ["store"]), { id: "a", customer: { organisationId: "org" }, tenancy: { facilityId: { in: ["store"] } } });
});
function entry(id: string, type: string, amount: string, date = "2026-09-10T10:00:00Z", reversalOfId?: string): StatementEntry { return { id, type, amount, effectiveAt: new Date(date), description: id, reversalOfId }; }
test("period includes the whole South African end day and validates calendar dates", () => {
  assert.equal(period.start.toISOString(), "2026-08-31T22:00:00.000Z");
  assert.equal(period.endExclusive.toISOString(), "2026-09-30T22:00:00.000Z");
  for (const [from, to] of [["2026-02-30", "2026-03-02"], ["2026-09-02", "2026-09-01"], ["x", "x"]]) assert.throws(() => statementPeriod(from, to));
});
test("statement includes opening, credits, refunds and no pending estimates", () => {
  const result = buildAccountStatement([entry("opening", "CHARGE", "100", "2026-08-01T00:00:00Z"), entry("rent", "CHARGE", "1000"), entry("paid", "PAYMENT", "900"), entry("credit", "CREDIT", "20"), entry("refund", "REFUND", "10"), entry("future", "CHARGE", "999", "2026-09-30T22:00:00Z")], period.start, period.endExclusive);
  assert.equal(result.openingBalance, "100.00"); assert.equal(result.closingBalance, "190.00"); assert.equal(result.rows.length, 4);
});
test("reversals follow the original transaction sign", () => {
  const result = buildAccountStatement([entry("charge", "CHARGE", "100"), entry("reverse", "REVERSAL", "100", undefined, "charge"), entry("payment", "PAYMENT", "50"), entry("reverse-payment", "REVERSAL", "50", undefined, "payment")], period.start, period.endExclusive);
  assert.equal(result.closingBalance, "0.00");
  assert.throws(() => buildAccountStatement([entry("bad", "REVERSAL", "5")], period.start, period.endExclusive));
});
test("cent arithmetic and empty periods", () => {
  assert.equal(buildAccountStatement([entry("a", "CHARGE", "0.10"), entry("b", "CHARGE", "0.20")], period.start, period.endExclusive).closingBalance, "0.30");
  assert.equal(buildAccountStatement([], period.start, period.endExclusive).closingBalance, "0.00");
});
