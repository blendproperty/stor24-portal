import { timingSafeEqual, createHash } from 'node:crypto';
import { processLeadSla } from '@/lib/lead-sla-service';
import { processSocialNotices } from '@/lib/whatchimp-social-service';
import { processWhatChimpNotices } from '@/lib/whatchimp-enquiry-notice';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const expected = process.env.LEAD_SLA_WORKER_KEY, presented = request.headers.get('x-sla-worker-key'), org = process.env.STOR24_ALERT_ORGANISATION_ID;
  const headers = { 'Cache-Control': 'no-store, max-age=0, private' };
  if (!expected || expected.length < 32 || !org) return Response.json({ error: 'Worker configuration required.' }, { status: 503, headers });
  if (!presented || !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(presented).digest())) return Response.json({ error: 'Unauthorised.' }, { status: 401, headers });
  const [sla, social, whatsapp] = await Promise.allSettled([processLeadSla(org), processSocialNotices(org), processWhatChimpNotices(org)]);
  if (sla.status === 'rejected' || social.status === 'rejected' || whatsapp.status === 'rejected' || social.value.errors || whatsapp.value.errors || whatsapp.value.review) return Response.json({ error: 'Escalation or notification processing requires review.' }, { status: 503, headers });
  return Response.json({ data: { ...sla.value, social: social.value, whatsapp: whatsapp.value } }, { headers });
}
