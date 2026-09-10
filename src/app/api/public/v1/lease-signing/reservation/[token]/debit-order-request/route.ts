import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { requestPublicDebitOrderSetup } from "@/lib/public-debit-order-request";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const { token } = await context.params;
  const input = await request.json().catch(() => null);
  const result = await requestPublicDebitOrderSetup(token, input);
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "COLLECTION_PREFERENCES_REQUIRED" ? "Choose a valid first collection date on or after move-in and a monthly debit day." : "This reservation is no longer available for debit-order setup. Contact STOR24 before proceeding." } }, { status: 409 });
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}
