import { db } from '@/lib/db';
import { keyHash, matchesIntakeKey } from '@/lib/whatchimp-enquiry-contract';
import { parseWhatChimpBody } from '@/lib/whatchimp-enquiry-body';
import { SOCIAL_INTAKE_DOMAIN, SOCIAL_NOTICE_DOMAIN, socialConfig, socialRequest } from '@/lib/whatchimp-social-contract';
import { captureSocialEnquiry, sendSocialNotice } from '@/lib/whatchimp-social-service';
import { rateLimit } from '@/lib/request-security';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0, private' };
async function boundedBody(request: Request) {
  if (Number(request.headers.get('content-length')) > 8192) throw Error('SOCIAL_BODY_TOO_LARGE');
  const reader = request.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 8192) { await reader.cancel(); throw Error('SOCIAL_BODY_TOO_LARGE'); } chunks.push(chunk.value); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
    if (!token) return Response.json({ ok: false, error: 'Authentication required.' }, { status: 401, headers });
    const connections = await db.configurationProfile.findMany({ where: { domain: SOCIAL_INTAKE_DOMAIN, status: 'READY' }, take: 100 });
    const matched = connections.filter(p => { const c = socialConfig.safeParse(p.config); return c.success && c.data.enabled && c.data.facilityId === p.facilityId && matchesIntakeKey(token, c.data.keyHash); });
    if (matched.length !== 1) return Response.json({ ok: false, error: 'Authentication failed.' }, { status: 401, headers });
    if (await rateLimit(`social-intake:${matched[0].id}`, 300, 60000)) return Response.json({ ok: false, error: 'Please retry shortly.' }, { status: 429, headers });
    const input = socialRequest.parse(await parseWhatChimpBody(await boundedBody(request), request.headers.get('content-type')));
    const result = await captureSocialEnquiry(matched[0].id, input, keyHash(token));
    if (result.phase === 'SUBMITTED' && result.leadReference) {
      const notice = await db.configurationProfile.findFirst({ where: { organisationId: matched[0].organisationId, facilityId: matched[0].facilityId, domain: SOCIAL_NOTICE_DOMAIN, name: result.leadReference, status: 'PENDING' } });
      if (notice) await sendSocialNotice(notice.id).catch(() => undefined);
    }
    return Response.json(result, { headers });
  } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError) return Response.json({ ok: false, error: 'Invalid enquiry request.' }, { status: 422, headers });
    const code = e instanceof Error ? e.message : '';
    if (code.startsWith('SOCIAL_')) return Response.json({ ok: false, error: code }, { status: code === 'SOCIAL_BODY_TOO_LARGE' ? 413 : code === 'SOCIAL_NOT_FOUND' ? 404 : 409, headers });
    return Response.json({ ok: false, error: 'Enquiry capture is temporarily unavailable. Please retry.' }, { status: 503, headers });
  }
}
