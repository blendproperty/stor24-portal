import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { cardAutopayScheduleSchema } from "./card-autopay-policy";
import { buildAccountStatement, type StatementEntry } from "../finance/account-statement";
import { southAfricaDateKey } from "../south-africa-time";

export const CARD_SUBSCRIPTION_DOMAIN = "CARD_AUTOPAY_SUBSCRIPTION";
export const CARD_EVENT_DOMAIN = "CARD_AUTOPAY_EVENT";
export const CARD_REQUEST_HISTORY_DOMAIN = "CARD_AUTOPAY_REQUEST_HISTORY";
export const CARD_PROVIDER_ACTION_DOMAIN = "CARD_AUTOPAY_PROVIDER_ACTION";
export const CARD_SUBSCRIPTION_OPEN_STATUSES = ["SETUP_ISSUED", "INITIAL_CARD_VERIFIED", "CARD_RECEIPTS_OBSERVED", "PROVIDER_METHOD_REVIEW", "PROVIDER_SOURCE_REVIEW", "SCHEDULE_CONFIRMATION_CLAIMED", "SCHEDULE_ACCEPTED", "SCHEDULE_CONFIRMATION_UNCERTAIN", "CANCELLATION_CLAIMED", "CANCELLATION_UNCERTAIN"];
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
const canonical = (value: unknown) => JSON.stringify(sorted(JSON.parse(JSON.stringify(value))));
export const cardSourceHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const money = z.string().regex(/^\d{1,6}\.\d{2}$/).refine(value => Number(value) > 0);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(100);
const definitionSchema = z.object({
  version: z.literal(1), accountId: id, customerId: id, tenancyId: id, facilityId: id, organisationId: id,
  requestId: id, requestFingerprint: hash, sourceFingerprint: hash,
  checkoutPaymentId: id, originalReference: z.string().regex(/^[A-Za-z0-9_-]{1,25}$/),
  connectionId: id, merchantHash: hash, environment: z.literal("sandbox"),
  schedule: cardAutopayScheduleSchema, monthlyAmount: money,
  documentId: id, invoiceReference: id, invoicePeriod: z.string().regex(/^\d{4}-\d{2}$/), initialAmount: money,
  consentText: z.string().min(1).max(2000), consentAt: z.iso.datetime(), signature: hash,
}).strict();
export type CardSubscriptionDefinition = z.infer<typeof definitionSchema>;
const eventSchema = z.object({
  version: z.literal(1), organisationId: id, facilityId: id, accountId: id, subscriptionId: id, paymentId: id,
  originalReference: z.string().regex(/^[A-Za-z0-9_-]{1,25}$/), traceHash: hash, traceEncrypted: z.string().min(1).max(1000),
  merchantHash: hash, environment: z.literal("sandbox"), amount: money,
  methodCode: z.string().regex(/^\d{1,2}$/).nullable(), accepted: z.boolean(),
  receivedAt: z.iso.datetime(), verifiedAt: z.iso.datetime(),
  allocation: z.literal("UNALLOCATED"), billingPeriod: z.null(), signature: hash,
}).strict();
export type CardSubscriptionEvent = z.infer<typeof eventSchema>;
function signature(value: unknown) {
  const key = process.env.AUTH_SECRET;
  if (!key || key.length < 32) throw Error("CARD_AUTOPAY_CONFIGURATION_REQUIRED");
  return createHmac("sha256", key).update("stor24-card-record:").update(canonical(value)).digest("hex");
}
export function signCardRecord<T extends object>(value: T): T & { signature: string } {
  return { ...value, signature: signature(value) };
}
function checkSignature(value: { signature: string }) {
  const { signature: expected, ...plain } = value;
  if (signature(plain) !== expected) throw Error("CARD_AUTOPAY_INTEGRITY_REVIEW");
}
export function readCardSubscription(value: unknown, scope: { organisationId: string; accountId?: string; facilityId?: string }) {
  const definition = definitionSchema.parse(value);
  checkSignature(definition);
  if (definition.organisationId !== scope.organisationId || (scope.accountId && definition.accountId !== scope.accountId) || (scope.facilityId && definition.facilityId !== scope.facilityId)) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
  return definition;
}
export function readCardEvent(value: unknown, scope: { organisationId: string; accountId: string; paymentId?: string }) {
  const event = eventSchema.parse(value);
  checkSignature(event);
  if (event.organisationId !== scope.organisationId || event.accountId !== scope.accountId || (scope.paymentId && event.paymentId !== scope.paymentId)) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
  return event;
}
export function cardEnrollmentConsent(initialAmount: string, invoiceReference: string, monthlyAmount: string, schedule: { startDate: string; cycles: number }) {
  return `I authorise Netcash test-account card setup for invoice ${invoiceReference}: R${initialAmount} initially, then ${schedule.cycles} monthly payments of R${monthlyAmount} starting ${schedule.startDate}. These are test-account transactions and will not reduce my Stor24 account balance. I will complete provider-hosted card authentication separately. If I do not complete setup before the start date, I must return for a fresh review.`;
}
/** Current-month fully unpaid source only. Broader partial/arrears allocations
 * require their own reviewed allocation evidence; never substitute a R1 fee.
 */
export function unpaidCardInvoice(input: {
  accountId: string; balance: string; entries: (StatementEntry & { externalRef: string | null; metadata: unknown })[];
  document: { id: string; idempotencyKey: string | null; externalId: string | null; content: string | null; sha256: string | null; status: string };
}, now = new Date()) {
  const period = southAfricaDateKey(now).slice(0, 7);
  const document = input.document;
  if (document.status !== "SENT" || !document.externalId || !document.content || document.sha256 !== createHash("sha256").update(document.content).digest("hex") || document.idempotencyKey !== `monthly-invoice:${input.accountId}:${period}`) throw Error("CARD_AUTOPAY_UNPAID_INVOICE_REQUIRED");
  const start = new Date(`${period}-01T00:00:00+02:00`);
  if (input.entries.some(entry => entry.effectiveAt > now)) throw Error("CARD_AUTOPAY_INVOICE_ALLOCATION_REVIEW");
  const full = buildAccountStatement(input.entries, new Date(0), new Date("9999-01-01"));
  const older = buildAccountStatement(input.entries, new Date(0), start);
  if (older.closingBalance !== "0.00" || full.closingBalance !== input.balance) throw Error("CARD_AUTOPAY_INVOICE_ALLOCATION_REVIEW");
  const lines = input.entries.filter(entry => entry.effectiveAt >= start);
  if (!lines.length || lines.some(entry => {
    const metadata = entry.metadata as { billingPeriod?: string; invoiceNumber?: string } | null;
    return !["CHARGE", "CREDIT"].includes(entry.type) || metadata?.billingPeriod !== period || metadata?.invoiceNumber !== document.externalId || !(entry.externalRef === `RENT-${period}` || entry.externalRef?.startsWith(`BILL-${period}-`));
  })) throw Error("CARD_AUTOPAY_INVOICE_ALLOCATION_REVIEW");
  const total = buildAccountStatement(lines, new Date(0), new Date("9999-01-01")).closingBalance;
  if (total !== input.balance || !money.safeParse(total).success) throw Error("CARD_AUTOPAY_UNPAID_INVOICE_REQUIRED");
  return { documentId: document.id, invoiceReference: document.externalId, invoicePeriod: period, initialAmount: total, sourceHash: cardSourceHash({ documentId: document.id, sha256: document.sha256, lines, balance: input.balance }) };
}
