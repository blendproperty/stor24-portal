import assert from "node:assert/strict";
import test from "node:test";
import { adjustmentInputSchema, refundLimits } from "../src/lib/adjustment-policy";
import { renderStatementHtml } from "../src/lib/finance/statement-renderer";
test("adjustment money input rejects negatives, rounding ambiguity and excessive precision", () => {
  const input = { accountId: "cmaccountfixture000001", kind: "CHARGE", amount: "115.50", taxAmount: "15.50", reason: "An agreed extra service", evidenceReference: "instruction-1" };
  assert.equal(adjustmentInputSchema.parse(input).amount, "115.50");
  for (const amount of ["-1", "0", "1.001", "1e2", "NaN", "Infinity"]) assert.equal(adjustmentInputSchema.safeParse({ ...input, amount }).success, false);
  assert.equal(adjustmentInputSchema.safeParse({ ...input, taxAmount: "116" }).success, false);
  assert.deepEqual(refundLimits({ defaults: { Refunds: { minimumRefund: 10, maximumRefund: "50.00" } } }), { minimum: 1000, maximum: 5000 });
  assert.throws(() => refundLimits({ defaults: { Refunds: { maximumRefund: "unlimited" } } }));
});
test("rendered statements debit refunds and require resolved reversal direction", () => {
  const base = { statementNumber: "CI", issueDate: new Date("2026-09-01"), periodFrom: new Date("2026-09-01"), periodTo: new Date("2026-09-30"), facilityName: "CI", company: {}, customerName: "CI", accountNumber: "CI", openingBalance: 0, closingBalance: 10 };
  const line = { id: "refund", type: "REFUND" as const, description: "Overpayment returned", effectiveAt: base.issueDate, amount: 10 };
  assert.doesNotMatch(renderStatementHtml({ ...base, lines: [line] }), /\(R\s*10/);
  assert.throws(() => renderStatementHtml({ ...base, lines: [{ ...line, type: "REVERSAL" }] }), /INVALID_REVERSAL/);
  assert.match(renderStatementHtml({ ...base, lines: [{ ...line, type: "REVERSAL", signedAmount: -10 }] }), /\(R[\s\S]*10/);
});

test("malformed refund policies cannot silently become unlimited or round a ceiling away", () => {
  const policy = (settings: unknown) => ({ defaults: { Refunds: settings } });
  for (const config of [[], "invalid", { defaults: [] }, { defaults: null }, policy(null), policy([]), policy(false), policy({ maximumRefund: 0.004 }), policy({ maximumRefund: "0.004" }), policy({ maximumRefund: "0x10" }), policy({ maximumRefund: " " }), policy({ minimumRefund: 60, maximumRefund: 50 })]) {
    assert.throws(() => refundLimits(config), /ADJUSTMENT_POLICY_REVIEW/, JSON.stringify(config));
  }
  for (const config of [undefined, null, {}, { defaults: {} }, policy({}), policy({ minimumRefund: "", maximumRefund: 0 })]) assert.deepEqual(refundLimits(config), { minimum: 0, maximum: 0 });
  assert.deepEqual(refundLimits(policy({ minimumRefund: 0.29, maximumRefund: "50.01" })), { minimum: 29, maximum: 5001 });
});