import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";
import {
  publicApiAuthorized,
  publicReservationSchema,
} from "@/lib/public-booking-contract";
import {
  createPublicReservation,
  PublicBookingError,
} from "@/lib/public-booking-service";

export async function POST(request: Request) {
  if (!publicApiAuthorized(request))
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Request rejected." } }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "The reservation details are invalid." } }, { status: 400 });
  }
  const parsed = publicReservationSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the highlighted reservation details.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });

  const clientIp = request.headers.get("x-stor24-client-ip") || requestIp(request);
  const ipHash = privacyHash(clientIp);
  const [ipLimited, emailLimited] = await Promise.all([
    rateLimit(`public-reservation:ip:${ipHash}`, 20, 60 * 60 * 1000),
    rateLimit(`public-reservation:email:${privacyHash(parsed.data.email)}`, 5, 60 * 60 * 1000),
  ]);
  if (ipLimited || emailLimited)
    return Response.json({ error: { code: "RATE_LIMITED", message: "Too many reservation attempts. Please try again later." } }, { status: 429 });

  try {
    const reservation = await createPublicReservation(parsed.data, ipHash);
    return Response.json({ data: reservation }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PublicBookingError)
      return Response.json({
        error: {
          code: error.code,
          message: error.code === "UNIT_UNAVAILABLE"
            ? "That unit is no longer available. Please choose another unit."
            : error.code === "FACILITY_NOT_FOUND"
              ? "That store is not available for online booking."
              : error.code === "VIEWING_SLOT_UNAVAILABLE"
                ? "Choose an available viewing appointment during the store's office hours within the next three days."
              : "This reservation request conflicts with an earlier request.",
        },
      }, { status: error.status });
    if (error instanceof Error && error.message === "OTP_DELIVERY_FAILED") return Response.json({ error: { code: "VERIFICATION_DELIVERY_FAILED", message: "We could not send the verification code. Check the mobile number and try again." } }, { status: 502 });
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "The reservation could not be completed." } }, { status: 500 });
  }
}
