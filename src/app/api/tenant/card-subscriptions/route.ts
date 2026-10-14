import { z } from "zod";
import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { cardAutopayScheduleSchema } from "@/lib/payments/card-autopay-policy";
import { previewCardAutopayRequest, saveCardAutopayRequest, withdrawCardAutopayRequest } from "@/lib/payments/card-autopay-service";
import { cardSandboxPreparationAvailable, cardSubscriptionSnapshot, previewCardEnrollment, issueCardEnrollment, previewCardCancellation, cancelCardSubscription } from "@/lib/payments/card-autopay-enrollment-service";

const id = z.string().min(1).max(100);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request-preview"), accountId: id, schedule: cardAutopayScheduleSchema }).strict(),
  z.object({ action: z.literal("request-save"), accountId: id, schedule: cardAutopayScheduleSchema, fingerprint, accepted: z.literal(true) }).strict(),
  z.object({ action: z.literal("withdraw-request"), accountId: id, requestId: id }).strict(),
  z.object({ action: z.literal("enrollment-preview"), accountId: id, documentId: id }).strict(),
  z.object({ action: z.literal("enroll"), accountId: id, documentId: id, fingerprint, accepted: z.literal(true) }).strict(),
  z.object({ action: z.literal("cancellation-preview"), subscriptionId: id }).strict(),
  z.object({ action: z.literal("cancel"), subscriptionId: id, fingerprint, accepted: z.literal(true) }).strict(),
]);
const messages: Record<string, string> = {
  CARD_AUTOPAY_UNPAID_INVOICE_REQUIRED: "A sent, approved and fully unpaid current-month invoice is needed before card setup.",
  CARD_AUTOPAY_INVOICE_ALLOCATION_REVIEW: "The invoice or account allocation needs staff review before card setup.",
  CARD_AUTOPAY_ENROLLMENT_ALREADY_ISSUED: "A card setup has already been issued. Review its status before another attempt.",
  CARD_AUTOPAY_PENDING_PAYMENT_REVIEW: "An existing payment is awaiting confirmation. Ask staff to review it first.",
  CARD_AUTOPAY_PREVIEW_CHANGED: "The source changed. Review the current terms again.",
  CARD_AUTOPAY_REQUEST_EXISTS: "A previous request is retained. Review or withdraw that request before preparing new terms.",
  CARD_AUTOPAY_PROVIDER_CANCELLATION_REQUIRED: "Provider card setup already exists. Use cancellation and confirm the provider outcome first.",
  CARD_AUTOPAY_CANCELLATION_OUTCOME_REVIEW: "The cancellation outcome needs provider review. It will not be automatically sent again.",
};
function failure(error: unknown) {
  if (error instanceof SyntaxError || (error instanceof Error && ["MANDATE_RESPONSE_TOO_LARGE", "MANDATE_RESPONSE_INVALID"].includes(error.message))) return Response.json({ error: "The request is invalid or too large." }, { status: 422, headers: tenantPrivateHeaders });
  if (error instanceof z.ZodError) return Response.json({ error: "Check the requested account, schedule and confirmation." }, { status: 422, headers: tenantPrivateHeaders });
  if (error instanceof Error && /^(?:CARD_AUTOPAY|TEST_PAYMENT)_/.test(error.message)) return Response.json({ error: messages[error.message] ?? "This account, schedule or provider setup needs staff review.", code: error.message }, { status: 409, headers: tenantPrivateHeaders });
  if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return Response.json({ error: "Another request changed this record. Reload its status before continuing." }, { status: 409, headers: tenantPrivateHeaders });
  return tenantError(error);
}
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const accountId = id.parse(new URL(request.url).searchParams.get("accountId"));
    if (await tenantRateLimit(`tenant:card-status:${session.tokenHash}`, 30, 60000)) return Response.json({ error: "Please wait before checking again." }, { status: 429, headers: tenantPrivateHeaders });
    return Response.json({ data: await cardSubscriptionSnapshot(session, accountId) }, { headers: tenantPrivateHeaders });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("TENANT_NOT_FOUND");
    const session = await requireTenantSession();
    if (await tenantRateLimit(`tenant:card-subscription:${session.tokenHash}`, 10, 60000)) return Response.json({ error: "Please wait before continuing." }, { status: 429, headers: tenantPrivateHeaders });
    const value = input.parse(JSON.parse((await boundedBody(new Response(request.body), 4096)).toString()));
    let result: unknown;
    switch (value.action) {
      case "request-preview":
        await cardSandboxPreparationAvailable(session, value.accountId);
        result = await previewCardAutopayRequest(session, value.accountId, value.schedule, new Date(), true);
        break;
      case "request-save":
        await cardSandboxPreparationAvailable(session, value.accountId);
        result = await saveCardAutopayRequest(session, value.accountId, value.schedule, value.fingerprint, value.accepted, new Date(), true);
        break;
      case "withdraw-request": result = await withdrawCardAutopayRequest(session, value.accountId, value.requestId); break;
      case "enrollment-preview": result = await previewCardEnrollment(session, value.accountId, value.documentId); break;
      case "enroll": result = await issueCardEnrollment(session, value.accountId, value.documentId, value.fingerprint, value.accepted); break;
      case "cancellation-preview": result = await previewCardCancellation(session, value.subscriptionId); break;
      case "cancel": result = await cancelCardSubscription(session, value.subscriptionId, value.fingerprint, value.accepted); break;
    }
    return Response.json({ data: result }, { headers: tenantPrivateHeaders });
  } catch (error) { return failure(error); }
}
