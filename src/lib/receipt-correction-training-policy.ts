import { z } from "zod";
import { createHash } from "node:crypto";
import { receiptReallocationInput, planReceiptReallocation, type ReceiptReallocationInput } from "./receipt-reallocation-policy";

export const receiptTrainingCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), input: receiptReallocationInput }).strict(),
  z.object({ action: z.literal("request"), input: receiptReallocationInput, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("decide"), id: z.cuid(), revision: z.literal(0), decision: z.literal("cancel"), reference: z.string().trim().min(5).max(200), confirmed: z.literal(true) }).strict(),
]);

export const receiptTrainingNotice = "TRAINING ONLY: sample accounts and receipt. No live tenancy, money, ledger, financial approval, provider or access change. Training requests cannot be approved or posted.";
export function receiptTrainingFixture(organisationId: string, facilityId: string) {
  const id = (label: string) => "c" + createHash("sha256").update(JSON.stringify(["receipt-training-v1", organisationId, facilityId, label])).digest("hex").slice(0, 24);
  const base = { organisationId, facilityId, currency: "ZAR", hasTenancy: true, inFlight: false };
  const accounts = [
    { ...base, id: id("source"), accountNumber: "TRAINING-RECEIPT-001", customerName: "TEST Brett - receipt source", balance: "-200.00", ledgerBalance: "-200.00" },
    { ...base, id: id("target"), accountNumber: "TRAINING-RECEIPT-002", customerName: "TEST Faeez - receipt destination", balance: "450.00", ledgerBalance: "450.00" },
  ];
  return { accounts, entryId: id("entry"), paymentId: id("receipt") };
}

/** Runs the production allocation planner on explicit, in-memory sample evidence.
 * These values must never be inserted into Account, Payment, Tenancy or LedgerEntry. */
export function previewReceiptTraining(organisationId: string, facilityId: string, raw: ReceiptReallocationInput) {
  const input = receiptReallocationInput.parse(raw), fixture = receiptTrainingFixture(organisationId, facilityId);
  if (input.operation !== "MOVE" || input.reversesId) throw Error("REALLOCATION_TRAINING_ONLY");
  const source = fixture.accounts.find(a => a.id === input.sourceAccountId), target = fixture.accounts.find(a => a.id === input.targetAccountId);
  if (!source || !target) throw Error("REALLOCATION_NOT_FOUND");
  const plan = planReceiptReallocation(input, source, target,
    { paymentId: fixture.paymentId, organisationId, facilityId, currency: "ZAR", provider: null, environment: null, status: "SUCCEEDED", amount: "200.00", refunded: "0.00", postedExactlyOnce: true, verified: true },
    [{ entryId: fixture.entryId, accountId: fixture.accounts[0].id, organisationId, facilityId, remaining: "200.00" }]);
  const money = (value: number) => (value / 100).toFixed(2);
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 1, trainingOnly: true, organisationId, facilityId, input })).digest("hex");
  return { fingerprint, operation: "MOVE" as const, source: { accountNumber: source.accountNumber, balance: source.balance }, target: { accountNumber: target.accountNumber, balance: target.balance }, amount: money(plan.amountCents), sourceBalanceAfter: money(plan.sourceBalanceAfterCents), targetBalanceAfter: money(plan.targetBalanceAfterCents), sourceReceiptRemaining: money(plan.sourceReceiptRemainingCents), notice: receiptTrainingNotice };
}
