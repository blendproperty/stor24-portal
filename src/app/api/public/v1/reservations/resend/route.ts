import { publicApiAuthorized, publicReservationResendSchema } from "@/lib/public-booking-contract";
import { resendPublicReservationVerification } from "@/lib/public-booking-service";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const parsed = publicReservationResendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "The reservation reference is invalid." } }, { status: 422 });
  if (await rateLimit(`public-verification-resend:${privacyHash(requestIp(request))}`, 3, 15 * 60 * 1000)) return Response.json({ error: { message: "Too many new codes requested. Try again later." } }, { status: 429 });
  const result = await resendPublicReservationVerification(parsed.data.reference);
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "DELIVERY_FAILED" ? "We could not send another code. Please contact Stor24." : "A new code cannot be requested for this reservation." } }, { status: result.code === "DELIVERY_FAILED" ? 502 : 410 });
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}
