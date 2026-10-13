import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { contactCorrectionSchema, correctPublicBookingContact } from "@/lib/public-booking-contact";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const ip = request.headers.get("x-stor24-client-ip")?.slice(0, 128) || requestIp(request);
  if (await rateLimit(`public-contact-correction:${privacyHash(ip)}`, 5, 15 * 60 * 1000)) return Response.json({ error: { message: "Too many corrections requested. Try again later." } }, { status: 429 });
  const parsed = contactCorrectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Enter a valid contact detail." } }, { status: 422 });
  const result = await correctPublicBookingContact(parsed.data);
  if (!result.ok) return Response.json({ error: { message: "This booking can no longer be changed here. Contact Stor24 for help." } }, { status: 409 });
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}
