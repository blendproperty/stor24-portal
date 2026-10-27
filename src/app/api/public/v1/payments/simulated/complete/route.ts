import { z } from "zod";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { completeSimulatedPayment } from "@/lib/public-payment-simulator";

const schema = z.object({ sessionId: z.string().min(10), checkoutToken: z.string().min(32), outcome: z.enum(["SUCCESS", "DECLINED", "CANCELLED", "TIMEOUT"]), paymentMethod: z.enum(["DEBIT_ORDER", "CARD", "EFT"]).optional() });
export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Invalid payment result." } }, { status: 422 });
  const result = await completeSimulatedPayment(parsed.data.sessionId, parsed.data.checkoutToken, parsed.data.outcome, parsed.data.paymentMethod, request.headers.get("x-stor24-identity-access") ?? "");
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "ID_SESSION_REQUIRED" ? "Verify your booking email again before continuing." : "Payment session unavailable." } }, { status: result.code === "DISABLED" ? 404 : result.code === "ID_SESSION_REQUIRED" ? 401 : 410 });
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}
