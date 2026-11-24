import { publicApiAuthorized } from '@/lib/public-booking-contract';
import { leadAttributionSchema } from '@/lib/lead-attribution';
import { privacyHash, rateLimit, requestIp } from '@/lib/request-security';
import { issueWhatsAppJourney } from '@/lib/whatsapp-website-journey';
import { boundedEnquiryBody } from '@/lib/whatchimp-enquiry-body';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return new Response(null, { status: 401, headers });
  let body: unknown;
  try { body = JSON.parse(await boundedEnquiryBody(request)); }
  catch { return new Response(null, { status: 400, headers }); }
  const attribution = leadAttributionSchema.safeParse(body);
  if (!attribution.success) return new Response(null, { status: 422, headers });

  try {
    const ip = request.headers.get('x-stor24-client-ip') || requestIp(request);
    if (await rateLimit(`whatsapp-journey:ip:${privacyHash(ip)}`, 30, 3600000) ||
        await rateLimit('whatsapp-journey:global', 300, 3600000)) {
      return new Response(null, { status: 429, headers });
    }
    const reference = await issueWhatsAppJourney(attribution.data);
    return reference
      ? Response.json({ reference }, { status: 201, headers })
      : new Response(null, { status: 503, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
