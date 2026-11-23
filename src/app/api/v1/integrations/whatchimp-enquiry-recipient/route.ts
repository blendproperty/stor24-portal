import { z } from 'zod';
import { db } from '@/lib/db';
import { authErrorResponse, requireOwner } from '@/lib/auth-guards';
import { reportRequestBody } from '@/lib/report-request-body';
import { sameOrigin } from '@/lib/request-security';
import { intakeConfigSchema, WHAT_CHIMP_DOMAIN } from '@/lib/whatchimp-enquiry-contract';
import { configureEnquiryRecipient, enquiryRecipientInput } from '@/lib/whatchimp-enquiry-recipient';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0, private' };

export async function GET() {
  try {
    const owner = await requireOwner(), organisationId = owner.user.organisationId;
    const [facilities, users, profiles] = await Promise.all([
      db.facility.findMany({ where: { organisationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db.user.findMany({ where: { organisationId, active: true }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      db.configurationProfile.findMany({ where: { organisationId, domain: WHAT_CHIMP_DOMAIN, name: 'bot475943', status: 'READY' }, select: { facilityId: true, config: true } }),
    ]);
    const connections = profiles.flatMap(p => { const c = intakeConfigSchema.safeParse(p.config); return c.success && c.data.enabled && c.data.facilityId === p.facilityId ? [{ facilityId: p.facilityId, recipientUserId: c.data.recipientUserId ?? null }] : []; });
    return Response.json({ data: { facilities, users, connections } }, { headers });
  } catch (error) { const response = authErrorResponse(error); response.headers.set('Cache-Control', headers['Cache-Control']); return response; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { message: 'Request rejected.' } }, { status: 403, headers });
  try {
    const owner = await requireOwner();
    const input = enquiryRecipientInput.parse(await reportRequestBody(request, 4096));
    await configureEnquiryRecipient({ id: owner.user.id, organisationId: owner.user.organisationId, sessionVersion: owner.user.sessionVersion }, input);
    return Response.json({ data: { configured: true } }, { headers });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof Error && error.message === 'INTAKE_RECIPIENT_INVALID') return Response.json({ error: { message: 'Check the active facility, connection and recipient permissions.' } }, { status: 409, headers });
    const response = authErrorResponse(error); response.headers.set('Cache-Control', headers['Cache-Control']); return response;
  }
}
