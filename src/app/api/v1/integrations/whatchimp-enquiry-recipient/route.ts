import { z } from 'zod';
import { db } from '@/lib/db';
import { authErrorResponse, requireOwner } from '@/lib/auth-guards';
import { currentRoleAccess } from '@/lib/current-role-access';
import { reportRequestBody } from '@/lib/report-request-body';
import { sameOrigin } from '@/lib/request-security';
import { intakeConfigSchema, WHAT_CHIMP_DOMAIN } from '@/lib/whatchimp-enquiry-contract';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0, private' };
const inputSchema = z.object({ facilityId: z.string().min(1), recipientUserId: z.string().min(1) }).strict();

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
    const input = inputSchema.parse(await reportRequestBody(request, 4096));
    const organisationId = owner.user.organisationId;
    await db.$transaction(async tx => {
      const facility = await tx.facility.findFirst({ where: { id: input.facilityId, organisationId, active: true } });
      const recipient = await tx.user.findFirst({ where: { id: input.recipientUserId, organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
      const profiles = await tx.configurationProfile.findMany({ where: { organisationId, facilityId: input.facilityId, domain: WHAT_CHIMP_DOMAIN, name: 'bot475943', status: 'READY' } });
      const parsed = profiles.length === 1 ? intakeConfigSchema.safeParse(profiles[0].config) : null;
      if (!facility || !recipient || !currentRoleAccess(recipient.roleAssignments, 'leads.view', input.facilityId).allowed || !currentRoleAccess(recipient.roleAssignments, 'leads.manage', input.facilityId).allowed || !parsed?.success || !parsed.data.enabled || parsed.data.facilityId !== input.facilityId) throw Error('INTAKE_RECIPIENT_INVALID');
      await tx.configurationProfile.update({ where: { id: profiles[0].id }, data: { config: { ...parsed.data, recipientUserId: recipient.id, recipientEmail: recipient.email } } });
      await tx.auditEvent.create({ data: { organisationId, facilityId: input.facilityId, actorId: owner.user.id, action: 'whatchimp.enquiry.recipient_configured', entityType: 'ConfigurationProfile', entityId: profiles[0].id, after: { recipientUserId: recipient.id } } });
    });
    return Response.json({ data: { configured: true } }, { headers });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof Error && error.message === 'INTAKE_RECIPIENT_INVALID') return Response.json({ error: { message: 'Check the active facility, connection and recipient permissions.' } }, { status: 409, headers });
    const response = authErrorResponse(error); response.headers.set('Cache-Control', headers['Cache-Control']); return response;
  }
}
