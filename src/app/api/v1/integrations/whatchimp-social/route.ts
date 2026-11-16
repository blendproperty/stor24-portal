import { authErrorResponse, requireOwner } from '@/lib/auth-guards';
import { reportRequestBody } from '@/lib/report-request-body';
import { sameOrigin } from '@/lib/request-security';
import { provisionSocialPair, revokeSocialPair, socialProvisionInput, socialRevokeInput } from '@/lib/whatchimp-social-provision';
import { db } from '@/lib/db';
import { SOCIAL_INTAKE_DOMAIN, socialConfig } from '@/lib/whatchimp-social-contract';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0, private', 'Pragma': 'no-cache' };

export async function GET() {
  try {
    const owner = await requireOwner();
    const organisationId = owner.user.organisationId;
    const [facilities, users, profiles] = await Promise.all([
      db.facility.findMany({ where: { organisationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db.user.findMany({ where: { organisationId, active: true }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      db.configurationProfile.findMany({ where: { organisationId, domain: SOCIAL_INTAKE_DOMAIN, status: 'READY' }, select: { id: true, facilityId: true, config: true } }),
    ]);
    const connections = profiles.map(p => { const c = socialConfig.safeParse(p.config); return { id: p.id, facilityId: p.facilityId, channel: c.success ? c.data.channel : 'unrecognised', botId: c.success ? c.data.botId : null }; });
    return Response.json({ data: { facilities, users, connections } }, { headers });
  } catch (error) { const response = authErrorResponse(error); response.headers.set('Cache-Control', headers['Cache-Control']); return response; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { message: 'Request rejected.' } }, { status: 403, headers });
  try {
    const owner = await requireOwner();
    const input = socialProvisionInput.parse(await reportRequestBody(request, 4096));
    const credentials = await provisionSocialPair({ id: owner.user.id, organisationId: owner.user.organisationId, sessionVersion: owner.user.sessionVersion }, input);
    return Response.json({ data: credentials }, { headers });
  } catch (error) {
    if (error instanceof Error && ['SOCIAL_SCOPE_INVALID', 'SOCIAL_CONNECTION_EXISTS'].includes(error.message)) return Response.json({ error: { message: error.message === 'SOCIAL_SCOPE_INVALID' ? 'Check the active facility and recipient permissions.' : 'A matching or active social connection already exists; no credentials were changed.' } }, { status: 409, headers });
    const response = authErrorResponse(error);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { message: 'Request rejected.' } }, { status: 403, headers });
  try {
    const owner = await requireOwner();
    const input = socialRevokeInput.parse(await reportRequestBody(request, 4096));
    await revokeSocialPair({ id: owner.user.id, organisationId: owner.user.organisationId, sessionVersion: owner.user.sessionVersion }, input);
    return Response.json({ data: { revoked: true } }, { headers });
  } catch (error) {
    if (error instanceof Error && error.message === 'SOCIAL_PAIR_NOT_FOUND') return Response.json({ error: { message: 'The exact active pair was not found; no credentials were changed.' } }, { status: 409, headers });
    const response = authErrorResponse(error); response.headers.set('Cache-Control', headers['Cache-Control']); return response;
  }
}
