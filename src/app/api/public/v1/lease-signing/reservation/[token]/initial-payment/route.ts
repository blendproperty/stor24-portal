import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { debitOrderInitialPaymentStatus, startDebitOrderInitialPayment } from "@/lib/debit-order-initial-payment";
import { privacyHash, rateLimit } from "@/lib/request-security";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
function failure() {
  return Response.json({ error: { message: "Your initial payment needs confirmation. Refresh its status or contact STOR24 before paying again. Online payments remain in test mode." } }, { status: 409, headers });
}
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return new Response(null, { status: 401 });
  try { return Response.json({ data: await debitOrderInitialPaymentStatus((await context.params).token) }, { headers }); } catch { return failure(); }
}
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return new Response(null, { status: 401 });
  const { token } = await context.params;
  if (await rateLimit(`debit-initial:${privacyHash(token)}`, 5, 15 * 60_000)) return Response.json({ error: { message: "Please wait before trying again." } }, { status: 429, headers });
  try { return Response.json({ data: await startDebitOrderInitialPayment(token) }, { status: 201, headers }); } catch { return failure(); }
}
