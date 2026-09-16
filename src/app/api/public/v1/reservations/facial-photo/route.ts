import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { getFacialSubmissionStatus, submitFacialPhoto } from "@/lib/facial-access-service";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";

export const runtime = "nodejs";

const errorStatus: Record<string, number> = {
  RESERVATION_UNAVAILABLE: 404,
  VERIFICATION_REQUIRED: 409,
  AGREEMENT_NOT_SIGNED: 409,
  DEBIT_ORDER_NOT_YET_SUPPORTED: 409,
  PAYMENT_NOT_CLEARED: 409,
  FACIAL_CONSENT_REQUIRED: 422,
  FACE_IMAGE_TYPE_INVALID: 422,
  FACE_IMAGE_SIZE_INVALID: 422,
  FACE_IMAGE_REQUIRED: 422,
};

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  if (await rateLimit(`facial-photo-submit:${privacyHash(requestIp(request))}`, 10, 15 * 60 * 1000)) {
    return Response.json({ error: { message: "Too many attempts. Try again later." } }, { status: 429 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: { message: "Invalid submission." } }, { status: 422 });
  const image = form.get("image");
  if (!(image instanceof File)) {
    return Response.json({ error: { code: "FACE_IMAGE_REQUIRED", message: "Choose a clear JPEG or PNG facial photograph." } }, { status: 422 });
  }
  const reference = String(form.get("reference") ?? "");
  const consent = form.get("consent") === "true";
  try {
    const result = await submitFacialPhoto(reference, { image, consent, ipHash: privacyHash(requestIp(request)) });
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return Response.json({ error: { code, message: "The facial photo could not be submitted." } }, { status: errorStatus[code] ?? 400 });
  }
}

export async function GET(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const url = new URL(request.url);
  const reference = url.searchParams.get("reference") ?? "";
  const result = await getFacialSubmissionStatus(reference);
  if (!result.ok) return Response.json({ error: { code: result.code, message: "That booking reference could not be found." } }, { status: 404 });
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}
