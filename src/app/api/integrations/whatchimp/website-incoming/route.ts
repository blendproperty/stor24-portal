import { boundedEnquiryBytes } from '@/lib/whatchimp-enquiry-body';
import { WHAT_CHIMP_BOT } from '@/lib/whatchimp-enquiry-contract';
import { captureWhatChimpEnquiry } from '@/lib/whatchimp-enquiry-service';
import { readWhatChimpIncoming, verifyWhatChimpIncoming, whatChimpSigningKey } from '@/lib/whatchimp-incoming-website';
import { resolveWebsiteIntake, websiteJourneyReference } from '@/lib/whatsapp-website-journey';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const key = whatChimpSigningKey(process.env.WHATCHIMP_STOR24_INCOMING_SECRET);
  if (!key) return new Response(null, { status: 503, headers });
  let raw: Buffer;
  try { raw = await boundedEnquiryBytes(request, 65536); }
  catch { return new Response(null, { status: 413, headers }); }
  const eventId = verifyWhatChimpIncoming(request.headers, raw, key);
  if (!eventId) return new Response(null, { status: 401, headers });
  let payload: unknown;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { return new Response(null, { status: 400, headers }); }

  const incoming = readWhatChimpIncoming(payload, eventId);
  const reference = incoming?.ad ? undefined : websiteJourneyReference(incoming?.text);
  if (!incoming || (!reference && !incoming.ad)) return new Response(null, { status: 204, headers });
  try {
    const connection = await resolveWebsiteIntake();
    if (!connection) return new Response(null, { status: 503, headers });
    await captureWhatChimpEnquiry(connection.id, {
      action: 'start', botId: WHAT_CHIMP_BOT, phone: incoming.phone, incomingMessage: reference ? `STOR24-REF-${reference}` : undefined,
    }, new Date(), connection.keyHash, { requireWebsiteReference: Boolean(reference), adReferral: incoming.ad });
  } catch (error) {
    if (!(error instanceof Error) || !['INTAKE_REFERENCE_NOT_ATTACHED', 'INTAKE_AD_REPLAY'].includes(error.message)) return new Response(null, { status: 503, headers });
  }
  return new Response(null, { status: 204, headers });
}
