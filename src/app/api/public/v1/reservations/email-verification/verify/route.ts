import { publicApiAuthorized, publicReservationVerificationSchema } from "@/lib/public-booking-contract";
import { verifyPublicReservationEmail } from "@/lib/public-booking-service";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  if (await rateLimit(`public-email-verification-check:${privacyHash(requestIp(request))}`, 15, 15 * 60 * 1000)) return Response.json({ error: { message: "Too many verification attempts. Try again later." } }, { status: 429 });
  const parsed = publicReservationVerificationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Enter the six-digit email code." } }, { status: 422 });
  const result = await verifyPublicReservationEmail(parsed.data.reference, parsed.data.code);
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "INVALID_CODE" ? "That email code is incorrect." : "The email verification window expired. Request a new code." } }, { status: result.code === "INVALID_CODE" ? 422 : 410 });
  return Response.json({ data: result });
}
