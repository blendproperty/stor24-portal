import { z } from "zod";
import { authErrorResponse } from "@/lib/auth-guards";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { billingPeriodSchema } from "@/lib/monthly-billing-policy";
import { getMonthlyBillingPlan, monthlyBillingAccounts, monthlyBillingInvoices, postMonthlyBilling, previewMonthlyBilling, saveMonthlyBillingPlan } from "@/lib/monthly-billing-service";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), accountId: z.string().cuid(), period: billingPeriodSchema }).strict(),
  z.object({ action: z.literal("post"), accountId: z.string().cuid(), period: billingPeriodSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("plan"), accountId: z.string().cuid(), plan: z.unknown() }).strict(),
]);
function failure(error: unknown) {
  const messages: Record<string, string> = {
    BILLING_RECONCILIATION_REQUIRED: "The saved balance and transaction history need finance review before billing. Check opening balances, corrections and future-dated entries; nothing has been posted.",
    BILLING_PLAN_REQUIRED: "Save approved billing terms for this account before previewing.",
    BILLING_BEFORE_APPROVED_START: "This month is earlier than the approved first unbilled month. Check the opening balance and billing history with finance.",
    BILLING_EXISTING_CHARGES_REVIEW: "This month already contains charges or corrections. Finance must reconcile them before monthly billing; nothing has been posted.",
    BILLING_ALREADY_POSTED: "This account has already been billed for this month. Reopen the account to view its saved invoices.",
    BILLING_PREVIEW_CHANGED: "The account changed after your preview. Preview again and check the new amounts before posting.",
    BILLING_TEST_PAYMENT_REVIEW: "Historical test-payment entries need reconciliation before this account can be billed.",
    BILLING_INSURANCE_REQUIRES_REVIEW: "Insurance billing is selected but the enrolled premium or coverage dates are incomplete. Check the customer's approved cover.",
    BILLING_OVERLAPPING_OCCUPANCIES: "Occupancy dates overlap. Correct the occupancy history before billing this month.",
    BILLING_TRANSFER_REQUIRES_REVIEW: "A full-month plan includes a unit transfer. Finance must confirm the agreed proration treatment before billing.",
    BILLING_DISCOUNT_EXCEEDS_RENT: "The discount exceeds this month's rent. Check the agreed discount and dates.",
    BILLING_NO_OCCUPANCY_IN_PERIOD: "There is no billable occupancy in this month.",
    BILLING_TENANCY_NOT_ACTIVE: "Monthly billing requires an active tenancy or an active notice period. Final bills for closed tenancies need a separate review.",
    BILLING_FUTURE_PERIOD: "Future months cannot be posted through this workflow.",
  };
  if (error instanceof Error && error.message.startsWith("BILLING_")) return Response.json({ error: { code: error.message, message: messages[error.message] || "This account requires review before billing can proceed." } }, { status: error.message === "BILLING_ACCOUNT_NOT_FOUND" ? 404 : 409 });
  if (error && typeof error === "object" && "code" in error && ["P2034", "P2002"].includes(String(error.code))) return Response.json({ error: { code: "BILLING_REVIEW_AGAIN", message: "Another change occurred. Reload and preview again before posting." } }, { status: 409 });
  return authErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("billing.view");
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (accountId) {
      z.string().cuid().parse(accountId);
      const [plan, invoices] = await Promise.all([getMonthlyBillingPlan(scope, accountId), monthlyBillingInvoices(scope, accountId)]);
      return Response.json({ data: { plan, invoices } });
    }
    return Response.json({ data: await monthlyBillingAccounts(scope) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const input = requestSchema.parse(await request.json());
    const scope = await requirePermissionScope(input.action === "preview" ? "billing.view" : input.action === "plan" ? "configuration.manage" : "billing.manage");
    const data = input.action === "plan" ? await saveMonthlyBillingPlan(scope, input.accountId, input.plan) : input.action === "preview" ? await previewMonthlyBilling(scope, input.accountId, input.period) : await postMonthlyBilling(scope, input.accountId, input.period, input.fingerprint);
    return Response.json({ data });
  } catch (error) { return failure(error); }
}
