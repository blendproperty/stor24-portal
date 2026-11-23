import { z } from 'zod';
import { db } from '@/lib/db';
import { currentRoleAccess } from '@/lib/current-role-access';
import { intakeConfigSchema, WHAT_CHIMP_DOMAIN } from '@/lib/whatchimp-enquiry-contract';

export const enquiryRecipientInput = z.object({ facilityId: z.string().min(1).max(100), recipientUserId: z.string().min(1).max(100) }).strict();
export async function configureEnquiryRecipient(actor: { id: string; organisationId: string; sessionVersion: number }, input: z.infer<typeof enquiryRecipientInput>) {
  const value = enquiryRecipientInput.parse(input);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${value.facilityId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${actor.id}, ${value.recipientUserId}) ORDER BY "id" FOR UPDATE`;
    const owner = await tx.user.findFirst({ where: { id: actor.id, organisationId: actor.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    if (!owner?.passwordHash || owner.sessionVersion !== actor.sessionVersion || !currentRoleAccess(owner.roleAssignments).owner) throw Error('FORBIDDEN');
    const facility = await tx.facility.findFirst({ where: { id: value.facilityId, organisationId: actor.organisationId, active: true } });
    const recipient = await tx.user.findFirst({ where: { id: value.recipientUserId, organisationId: actor.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    const profiles = await tx.configurationProfile.findMany({ where: { organisationId: actor.organisationId, facilityId: value.facilityId, domain: WHAT_CHIMP_DOMAIN, name: 'bot475943', status: 'READY' } });
    const parsed = profiles.length === 1 ? intakeConfigSchema.safeParse(profiles[0].config) : null;
    if (!facility || !recipient || !currentRoleAccess(recipient.roleAssignments, 'leads.view', value.facilityId).allowed || !currentRoleAccess(recipient.roleAssignments, 'leads.manage', value.facilityId).allowed || !parsed?.success || !parsed.data.enabled || parsed.data.facilityId !== value.facilityId) throw Error('INTAKE_RECIPIENT_INVALID');
    const config = intakeConfigSchema.parse({ ...parsed.data, recipientUserId: recipient.id, recipientEmail: recipient.email });
    await tx.configurationProfile.update({ where: { id: profiles[0].id }, data: { config } });
    await tx.auditEvent.create({ data: { organisationId: actor.organisationId, facilityId: value.facilityId, actorId: actor.id, action: 'whatchimp.enquiry.recipient_configured', entityType: 'ConfigurationProfile', entityId: profiles[0].id, after: { recipientUserId: recipient.id } } });
  }, { isolationLevel: 'Serializable' });
}
