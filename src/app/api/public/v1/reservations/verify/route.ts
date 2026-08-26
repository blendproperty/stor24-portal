import { publicApiAuthorized, publicReservationVerificationSchema } from "@/lib/public-booking-contract";
import { verifyPublicReservation } from "@/lib/public-booking-service";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const parsed = publicReservationVerificationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Enter the six-digit verification code." } }, { status: 422 });
  if (await rateLimit(`public-verification:${privacyHash(requestIp(request))}`, 15, 15 * 60 * 1000)) return Response.json({ error: { message: "Too many verification attempts. Try again later." } }, { status: 429 });
  const result = await verifyPublicReservation(parsed.data.reference, parsed.data.code);
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "INVALID_CODE" ? "That code is incorrect." : result.code === "DISABLED" ? "Mobile verification is not currently enabled." : "The verification window has expired. Please choose the unit again." } }, { status: result.code === "INVALID_CODE" ? 422 : result.code === "DISABLED" ? 404 : 410 });
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}
