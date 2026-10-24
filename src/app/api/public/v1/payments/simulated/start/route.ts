import { z } from "zod";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { startSimulatedPayment } from "@/lib/public-payment-simulator";

const schema = z.object({ reference: z.string().trim().min(10).max(40), idempotencyKey: z.string().uuid() });
export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Invalid payment request." } }, { status: 422 });
  const result = await startSimulatedPayment(parsed.data.reference, parsed.data.idempotencyKey, request.headers.get("x-stor24-identity-access") ?? "");
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "DISABLED" ? "Payment UAT is not enabled." : result.code === "ID_SESSION_REQUIRED" ? "Verify your booking email again before continuing." : "This reservation is not available for payment." } }, { status: result.code === "DISABLED" ? 404 : result.code === "ID_SESSION_REQUIRED" ? 401 : 409 });
  return Response.json({ data: result }, { status: 201, headers: { "cache-control": "no-store" } });
}
