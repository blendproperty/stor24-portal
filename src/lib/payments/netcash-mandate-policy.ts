import { z } from "zod";

// Intentionally no invented cancellation/holiday or first-payment policy.
// This is separate from the Pay Now transaction switch. No collection code is enabled.
const policySchema = z.object({
  organisationId: z.string().min(1),
  approvedBy: z.string().min(3),
  noticeDays: z.number().int().min(1).max(60),
  holiday: z.enum(["PrecedingOrdinaryBusinessDay", "VeryNextOrdinaryBusinessDay"]),
  allowedDays: z.array(z.number().int().min(1).max(28)).min(1),
  recurringAmountBasis: z.literal("SIGNED_MONTHLY_RENT_ONLY"),
  firstPaymentHandling: z.literal("SEPARATE_APPROVED_PAYMENT"),
  postbackConfigured: z.literal(true),
});
export function mandatePolicy(env: Record<string, string | undefined> = process.env) {
  if (env.NETCASH_MANDATE_SETUP_ENABLED !== "true") return null;
  try { return policySchema.parse(JSON.parse(env.NETCASH_MANDATE_POLICY ?? "")); }
  catch { return null; }
}
