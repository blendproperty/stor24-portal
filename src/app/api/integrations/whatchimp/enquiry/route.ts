import { db } from '@/lib/db';
import { enquiryRequestSchema, intakeConfigSchema, keyHash, matchesIntakeKey, WHAT_CHIMP_DOMAIN } from '@/lib/whatchimp-enquiry-contract';
import { captureWhatChimpEnquiry } from '@/lib/whatchimp-enquiry-service';
import { rateLimit } from '@/lib/request-security';
import { ZodError } from 'zod';
import { boundedEnquiryBody, parseWhatChimpBody } from '@/lib/whatchimp-enquiry-body';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0, private' };
export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
    if (!token) return Response.json({ ok: false, error: 'Authentication required.' }, { status: 401, headers });
    const connections = await db.configurationProfile.findMany({ where: { domain: WHAT_CHIMP_DOMAIN, name: 'bot475943', status: 'READY' }, take: 100 });
    const matched = connections.filter(p => { const c = intakeConfigSchema.safeParse(p.config); return c.success && c.data.enabled && c.data.facilityId === p.facilityId && matchesIntakeKey(token, c.data.keyHash); });
    if (matched.length !== 1) return Response.json({ ok: false, error: 'Authentication failed.' }, { status: 401, headers });
    if (await rateLimit(`whatchimp-intake:${matched[0].id}`, 300, 60000)) return Response.json({ ok: false, error: 'Please retry shortly.' }, { status: 429, headers });
    const body = await boundedEnquiryBody(request);
    const input = enquiryRequestSchema.parse(await parseWhatChimpBody(body, request.headers.get('content-type')));
    const result = await captureWhatChimpEnquiry(matched[0].id, input, new Date(), keyHash(token));
    return Response.json(result, { headers });
  } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError) return Response.json({ ok: false, error: 'Invalid enquiry request.' }, { status: 422, headers });
    const code = e instanceof Error ? e.message : '';
    if (code.startsWith('INTAKE_')) return Response.json({ ok: false, error: code }, { status: code === 'INTAKE_BODY_TOO_LARGE' ? 413 : code === 'INTAKE_NOT_FOUND' ? 404 : 409, headers });
    if (code.includes('P2034')) return Response.json({ ok: false, error: 'Please retry your request.' }, { status: 409, headers });
    return Response.json({ ok: false, error: 'Enquiry capture is temporarily unavailable. Please retry.' }, { status: 503, headers });
  }
}
