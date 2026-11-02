import {after} from "next/server";
import {queueSavedMetaLead,processMetaConversions} from "@/lib/meta-conversions";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { publicLeadSchema } from "@/lib/public-lead-contract";
import { createPublicLead, PublicLeadError } from "@/lib/public-lead-service";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!publicApiAuthorized(request))
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Request rejected." } }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: { code: "INVALID_JSON", message: "The quote details are invalid." } }, { status: 400 }); }

  const parsed = publicLeadSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the submitted quote details.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });

  if (parsed.data.honeypot) return Response.json({ data: { accepted: true } }, { status: 201 });

  const clientIp = request.headers.get("x-stor24-client-ip") || requestIp(request);
  const ipHash = privacyHash(clientIp);
  const [ipLimited, emailLimited] = await Promise.all([
    rateLimit(`public-lead:ip:${ipHash}`, 20, 60 * 60 * 1000),
    rateLimit(`public-lead:email:${privacyHash(parsed.data.email)}`, 5, 60 * 60 * 1000),
  ]);
  if (ipLimited || emailLimited)
    return Response.json({ error: { code: "RATE_LIMITED", message: "Too many quote requests. Please try again later." } }, { status: 429 });

  try {
    const lead = await createPublicLead(parsed.data, ipHash);
    const measurementEventId=await queueSavedMetaLead(lead.id, parsed.data.conversionTracking, clientIp, request.headers.get("x-stor24-user-agent"));
    if(measurementEventId)after(()=>processMetaConversions().then(()=>{}));
    return Response.json({ data: {...lead,measurementEventId} }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PublicLeadError)
      return Response.json({ error: { code: error.code, message: "That area is not yet available for online quotes." } }, { status: error.status });
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "The quote could not be submitted." } }, { status: 500 });
  }
}
