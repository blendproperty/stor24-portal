import { publicApiAuthorized, publicReservationResendSchema } from "@/lib/public-booking-contract";
import { startPublicEmailVerification } from "@/lib/public-booking-service";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  if (await rateLimit(`public-email-verification:${privacyHash(requestIp(request))}`, 5, 15 * 60 * 1000)) return Response.json({ error: { message: "Too many email codes requested. Try again later." } }, { status: 429 });
  const parsed = publicReservationResendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Invalid reservation reference." } }, { status: 422 });
  const result = await startPublicEmailVerification(parsed.data.reference);
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "DELIVERY_FAILED" ? "We could not send the email code. Check the email address or contact Stor24." : "Email verification is unavailable." } }, { status: result.code === "DELIVERY_FAILED" ? 502 : 404 });
  return Response.json({ data: result });
}
