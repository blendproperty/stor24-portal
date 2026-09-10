import { completePublicReservationLease, getPublicReservationLease } from "@/lib/public-lease-workflow";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { leaseSignatureSchema } from "@/lib/validators";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";
import { z } from "zod";

const publicSignatureSchema = leaseSignatureSchema.extend({ termsAccepted: z.boolean().optional(), acceptedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const { token } = await context.params;
  const lease = await getPublicReservationLease(token);
  if (!lease) return Response.json({ error: { code: "NOT_FOUND", message: "This lease is unavailable." } }, { status: 404 });
  return Response.json({ data: lease }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const { token } = await context.params;
  if (await rateLimit(`public-reservation-lease:${privacyHash(token)}`, 10, 60 * 60 * 1000)) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } }, { status: 429 });
  const parsed = publicSignatureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Initial every clause and enter the signer's full name.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
  try {
    const result = await completePublicReservationLease(token, { ...parsed.data, signerIp: requestIp(request), signerUserAgent: request.headers.get("user-agent") });
    return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const status = code === "EXPIRED" ? 410 : code === "VALIDATION_ERROR" ? 422 : code === "CONFLICT" ? 409 : code === "NOT_FOUND" ? 404 : 500;
    return Response.json({ error: { code, message: code === "EXPIRED" ? "This signing window has expired." : "The lease could not be signed." } }, { status });
  }
}
