import { sendMonthlyMandateInvitation } from "@/lib/monthly-mandate-invitation";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { chooseFuturePayments, recurringPaymentStatus } from "@/lib/public-recurring-payments";
import { requestPublicDebitOrderSetup } from "@/lib/public-debit-order-request";
async function handle(request: Request, token: string) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  try {
    if (request.method === "POST") {
      const input = await request.json();
      if (input?.action === "resend") return Response.json({ data: { invitationStatus: await sendMonthlyMandateInvitation(token, true) } }, { headers: { "cache-control": "no-store" } });
      if (!["DEBIT_ORDER", "MANUAL"].includes(input?.choice)) return Response.json({ error: { message: "Choose how to pay future rent." } }, { status: 400 });
      await chooseFuturePayments(token, input.choice);
      if (input.choice === "DEBIT_ORDER") {
        const saved = await requestPublicDebitOrderSetup(token, input.preferences);
        if (!saved.ok && saved.code !== "MANDATE_ALREADY_STARTED") return Response.json({ error: { message: saved.message || "Review your collection dates before signing." } }, { status: 409 });
      }
    }
    return Response.json({ data: await recurringPaymentStatus(token) }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch { return Response.json({ error: { message: "Future-payment setup needs a signed agreement and a confirmed upfront payment. Check your booking or contact STOR24." } }, { status: 409 }); }
}
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) { return handle(request, (await context.params).token); }
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) { return handle(request, (await context.params).token); }
