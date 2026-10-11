import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { hostedMandateStatus, refreshHostedMandate, startHostedMandate } from "@/lib/public-hosted-mandate";
import { privacyHash, rateLimit } from "@/lib/request-security";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
function failure(error: unknown) {
  const code = error instanceof Error && /^MANDATE_[A-Z0-9_]+$/.test(error.message) ? error.message : "MANDATE_TEMPORARILY_UNAVAILABLE";
  const messages: Record<string, string> = {
    MANDATE_CONFIGURATION_REQUIRED: "Secure mandate setup is awaiting STOR24 configuration. Your agreement is safe.",
    MANDATE_SCHEDULE_REVIEW_REQUIRED: "Change your collection dates: recurring rent must start after the rental months in your first payment, on the approved monthly debit day in this calendar year.",
    MANDATE_INITIAL_RENT_REVIEW_REQUIRED: "STOR24 must confirm your initial invoice and covered rental months before arranging recurring collections.",
    MANDATE_BOOKING_UNAVAILABLE: "STOR24 needs to confirm this reservation before mandate setup.",
    MANDATE_REPORT_PENDING: "Netcash is preparing confirmation. Please check again shortly.",
    MANDATE_BUSINESS_DETAILS_REQUIRED: "A business mandate needs the company and authorised signatory details. Please contact STOR24.",
  };
  return Response.json({ error: { code, message: messages[code] ?? "We could not confirm your mandate. Please retry checking its status; do not create a second mandate." } }, { status: 409, headers });
}
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return new Response(null, { status: 401 });
  try { return Response.json({ data: await hostedMandateStatus((await context.params).token) }, { headers }); } catch (e) { return failure(e); }
}
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return new Response(null, { status: 401 });
  const { token } = await context.params;
  if (await rateLimit(`mandate:${privacyHash(token)}`, 20, 15 * 60_000)) return Response.json({ error: { message: "Please wait before checking again." } }, { status: 429, headers });
  const input = await request.json().catch(() => null);
  try {
    if (input?.action === "start") return Response.json({ data: await startHostedMandate(token) }, { headers });
    if (input?.action === "refresh") return Response.json({ data: await refreshHostedMandate(token) }, { headers });
    return Response.json({ error: { message: "Choose start or refresh." } }, { status: 400, headers });
  } catch (e) { return failure(e); }
}
