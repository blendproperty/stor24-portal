import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { requestPublicDebitOrderSetup } from "@/lib/public-debit-order-request";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const { token } = await context.params;
  const result = await requestPublicDebitOrderSetup(token);
  if (!result.ok) return Response.json({ error: { code: result.code, message: "Debit-order setup is unavailable." } }, { status: 409 });
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}
