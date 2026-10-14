import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { netcashMethodLabels } from "./netcash-methods";
export { netcashMethodLabels } from "./netcash-methods";
export const NETCASH_EVIDENCE_DOMAIN = "NETCASH_PAYMENT_EVIDENCE";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const signed = (value: unknown) => { const key = process.env.AUTH_SECRET; if (!key || key.length < 32) throw Error("NETCASH_EVIDENCE_CONFIGURATION_REQUIRED"); return createHmac("sha256", key).update(JSON.stringify(value)).digest("hex"); };
const schema = z.object({ version: z.literal(1), paymentId: z.string(), environment: z.enum(["sandbox", "live"]), methodCode: z.string().regex(/^\d{1,2}$/).nullable(), accepted: z.boolean(), currency: z.literal("ZAR"), amount: z.string().regex(/^\d+\.\d{2}$/), referenceHash: z.string().length(64), traceHash: z.string().length(64), merchantHash: z.string().length(64), checkedAt: z.iso.datetime(), signature: z.string().length(64) }).strict();
const unsigned = (value: z.infer<typeof schema>) => [value.version, value.paymentId, value.environment, value.methodCode, value.accepted, value.currency, value.amount, value.referenceHash, value.traceHash, value.merchantHash, value.checkedAt];
export function netcashPaymentEvidenceValue(input: { paymentId: string; environment: "sandbox" | "live"; methodCode: string | null; accepted: boolean; amount: string; reference: string | null; trace: string; merchantHash: string; checkedAt: string }) {
  const value = { version: 1 as const, paymentId: input.paymentId, environment: input.environment, methodCode: input.methodCode, accepted: input.accepted, currency: "ZAR" as const, amount: input.amount, referenceHash: digest(input.reference), traceHash: digest(input.trace), merchantHash: input.merchantHash, checkedAt: input.checkedAt, signature: "" };
  value.signature = signed(unsigned(value));
  return schema.parse(value);
}
export function readNetcashEvidence(value: unknown, payment: { id: string; providerRef: string | null; providerOriginalRef?: string | null; amount: { toFixed: (n: number) => string }; environment: string | null; currency?: string; providerMerchantKey?: string | null }) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const record = parsed.data;
  if (record.paymentId !== payment.id || record.referenceHash !== digest(payment.providerOriginalRef ?? payment.providerRef) || record.amount !== payment.amount.toFixed(2) || record.environment !== payment.environment || payment.currency !== "ZAR" || record.merchantHash !== payment.providerMerchantKey || record.signature !== signed(unsigned(record))) return null;
  return { methodCode: record.methodCode, method: netcashMethodLabels[record.methodCode ?? ""] ?? "Unclassified Netcash method", accepted: record.accepted, checkedAt: record.checkedAt };
}
