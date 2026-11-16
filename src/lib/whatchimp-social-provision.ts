import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { currentRoleAccess } from '@/lib/current-role-access';
import { keyHash } from '@/lib/whatchimp-enquiry-contract';
import { SOCIAL_INTAKE_DOMAIN, socialConfig } from '@/lib/whatchimp-social-contract';

const botId = z.union([z.string().regex(/^\d{1,30}$/), z.uuid()]);
export const socialProvisionInput = z.object({ facilityId: z.string().min(1).max(100), recipientUserId: z.string().min(1).max(100), recipientEmail: z.email().max(320), facebookBotId: botId, instagramBotId: botId }).strict().refine(v => v.facebookBotId !== v.instagramBotId);

export async function provisionSocialPair(actor: { id: string; organisationId: string; sessionVersion: number }, input: z.infer<typeof socialProvisionInput>) {
  const value = socialProvisionInput.parse(input);
  const facebook = randomBytes(32).toString('base64url');
  const instagram = randomBytes(32).toString('base64url');
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${value.facilityId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${actor.id}, ${value.recipientUserId}) ORDER BY "id" FOR UPDATE`;
    const owner = await tx.user.findFirst({ where: { id: actor.id, organisationId: actor.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    if (!owner?.passwordHash || owner.sessionVersion !== actor.sessionVersion || !currentRoleAccess(owner.roleAssignments).owner) throw Error('FORBIDDEN');
    const facility = await tx.facility.findFirst({ where: { id: value.facilityId, organisationId: actor.organisationId, active: true }, select: { id: true } });
    const recipient = await tx.user.findFirst({ where: { id: value.recipientUserId, organisationId: actor.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    if (!facility || !recipient || recipient.email.trim().toLowerCase() !== value.recipientEmail.trim().toLowerCase() || !currentRoleAccess(recipient.roleAssignments, 'leads.view', facility.id).allowed) throw Error('SOCIAL_SCOPE_INVALID');
    const existing = await tx.configurationProfile.findMany({ where: { organisationId: actor.organisationId, facilityId: facility.id, domain: SOCIAL_INTAKE_DOMAIN } });
    if (existing.some(p => p.status === 'READY')) throw Error('SOCIAL_CONNECTION_EXISTS');
    for (const [channel, id, token] of [['facebook', value.facebookBotId, facebook], ['instagram', value.instagramBotId, instagram]] as const) {
      const config = socialConfig.parse({ enabled: true, channel, botId: id, keyHash: keyHash(token), facilityId: facility.id, recipientUserId: recipient.id, recipientEmail: recipient.email });
      const profile = await tx.configurationProfile.create({ data: { organisationId: actor.organisationId, facilityId: facility.id, domain: SOCIAL_INTAKE_DOMAIN, name: `${channel}-${id}-${randomUUID()}`, status: 'READY', config } });
      await tx.auditEvent.create({ data: { organisationId: actor.organisationId, facilityId: facility.id, actorId: actor.id, action: 'whatchimp.social.provisioned', entityType: 'configurationProfile', entityId: profile.id, after: { channel, botId: id, recipientUserId: recipient.id } } });
    }
  }, { isolationLevel: 'Serializable' });
  return { facebook, instagram };
}

export const socialRevokeInput = z.object({ facilityId: z.string().min(1).max(100), facebookBotId: botId, instagramBotId: botId }).strict().refine(v => v.facebookBotId !== v.instagramBotId);
export async function revokeSocialPair(actor: { id: string; organisationId: string; sessionVersion: number }, input: z.infer<typeof socialRevokeInput>) {
  const value = socialRevokeInput.parse(input);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${value.facilityId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
    const owner = await tx.user.findFirst({ where: { id: actor.id, organisationId: actor.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    if (!owner?.passwordHash || owner.sessionVersion !== actor.sessionVersion || !currentRoleAccess(owner.roleAssignments).owner) throw Error('FORBIDDEN');
    const profiles = await tx.configurationProfile.findMany({ where: { organisationId: actor.organisationId, facilityId: value.facilityId, domain: SOCIAL_INTAKE_DOMAIN, status: 'READY' } });
    const matches = profiles.filter(p => { const c = socialConfig.safeParse(p.config); return c.success && ((c.data.channel === 'facebook' && c.data.botId === value.facebookBotId) || (c.data.channel === 'instagram' && c.data.botId === value.instagramBotId)); });
    if (matches.length !== 2 || profiles.length !== 2 || new Set(matches.map(p => socialConfig.parse(p.config).channel)).size !== 2) throw Error('SOCIAL_PAIR_NOT_FOUND');
    for (const profile of matches) {
      await tx.configurationProfile.update({ where: { id: profile.id }, data: { status: 'DISABLED', config: { ...socialConfig.parse(profile.config), enabled: false } } });
      await tx.auditEvent.create({ data: { organisationId: actor.organisationId, facilityId: value.facilityId, actorId: actor.id, action: 'whatchimp.social.revoked', entityType: 'configurationProfile', entityId: profile.id } });
    }
  }, { isolationLevel: 'Serializable' });
}
