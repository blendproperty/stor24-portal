import { randomUUID, createHash } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { currentRoleAccess } from '@/lib/current-role-access';
import { emailProvider, type EmailMessage } from '@/lib/email';
import { resolveIntakeCalendar } from '@/lib/whatchimp-enquiry-service';
import { intakeHours } from '@/lib/whatchimp-enquiry-contract';
import { SOCIAL_INTAKE_DOMAIN, SOCIAL_SESSION_DOMAIN, SOCIAL_NOTICE_DOMAIN, normalizeSocialPhone, socialConfig, type SocialRequest } from '@/lib/whatchimp-social-contract';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Session = { connectionId: string; channel: 'facebook' | 'instagram'; leadId?: string; requestHash?: string };

export async function captureSocialEnquiry(connectionId: string, input: SocialRequest, verifiedKeyHash: string) {
  const connection = await db.configurationProfile.findUnique({ where: { id: connectionId } });
  if (!connection || connection.domain !== SOCIAL_INTAKE_DOMAIN || connection.status !== 'READY' || !connection.facilityId) throw Error('SOCIAL_DISABLED');
  const config = socialConfig.parse(connection.config);
  if (!config.enabled || config.facilityId !== connection.facilityId || config.keyHash !== verifiedKeyHash) throw Error('SOCIAL_DISABLED');
  const { organisationId, facilityId } = connection;
  if (!await db.facility.findFirst({ where: { id: facilityId, organisationId, active: true }, select: { id: true } })) throw Error('SOCIAL_DISABLED');
  if (input.action === 'probe') return { ok: true, phase: 'PROBE' };
  if (input.action === 'validate') return { ok: true, phase: normalizeSocialPhone(input.phone) ? 'VALID_PHONE' : 'INVALID_PHONE' };
  if (input.action === 'start') {
    const key = randomUUID();
    await db.configurationProfile.create({ data: { organisationId, facilityId, domain: SOCIAL_SESSION_DOMAIN, name: key, status: 'CAPTURING', config: { connectionId, channel: config.channel } } });
    return { ok: true, phase: 'START', enquiryKey: key };
  }
  const phone = normalizeSocialPhone(input.phone);
  if (!phone) return { ok: true, phase: 'INVALID_PHONE' };
  const requestHash = hash([input.name, phone, input.requirements, input.startDate]);
  const hours = intakeHours(new Date(), await resolveIntakeCalendar(organisationId, facilityId));
  const label = config.channel === 'facebook' ? 'Facebook Messenger' : 'Instagram';
  const result = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${organisationId}:${facilityId}:${input.enquiryKey}`}, 0))`;
    const current = await tx.configurationProfile.findUnique({ where: { id: connectionId } });
    if (!current || current.status !== 'READY' || current.updatedAt.getTime() !== connection.updatedAt.getTime()) throw Error('SOCIAL_DISABLED');
    const session = await tx.configurationProfile.findFirst({ where: { organisationId, facilityId, domain: SOCIAL_SESSION_DOMAIN, name: input.enquiryKey } });
    if (!session) throw Error('SOCIAL_NOT_FOUND');
    const state = session.config as Session;
    if (state.connectionId !== connectionId || state.channel !== config.channel) throw Error('SOCIAL_NOT_FOUND');
    if (state.leadId) {
      if (session.status !== 'SUBMITTED') throw Error('SOCIAL_SESSION_REVIEW');
      if (state.requestHash !== requestHash) throw Error('SOCIAL_ALREADY_SUBMITTED');
      return { leadId: state.leadId, duplicate: true };
    }
    if (session.status !== 'CAPTURING' || Date.now() - session.createdAt.getTime() > 7 * 86400000) throw Error('SOCIAL_SESSION_EXPIRED');
    const customer = await tx.customer.create({ data: { organisationId, firstName: input.name, phone, communicationConsent: { source: `WHATCHIMP_${config.channel.toUpperCase()}_ENQUIRY`, purpose: 'RESPOND_TO_ENQUIRY', recordedAt: new Date().toISOString(), phone: true, whatsapp: false, email: false, sms: false } } });
    const lead = await tx.lead.create({ data: { facilityId, customerId: customer.id, source: label, stage: 'NEW', nextActionAt: hours.nextOpening, notes: `${label} pricing enquiry\nStorage requirements: ${input.requirements}\nPreferred start: ${input.startDate}\nThis enquiry does not reserve a unit.` } });
    await tx.task.create({ data: { organisationId, facilityId, customerId: customer.id, title: `${label} pricing enquiry â€” staff follow-up`, description: `Review the enquiry in lead to lease: /leads?lead=${encodeURIComponent(lead.id)}`, dueAt: hours.nextOpening } });
    await tx.configurationProfile.update({ where: { id: session.id }, data: { status: 'SUBMITTED', config: { ...state, leadId: lead.id, requestHash } } });
    await tx.configurationProfile.create({ data: { organisationId, facilityId, domain: SOCIAL_NOTICE_DOMAIN, name: lead.id, status: 'PENDING', config: { connectionId, recipientUserId: config.recipientUserId, channel: config.channel } } });
    await tx.auditEvent.create({ data: { organisationId, facilityId, action: 'whatchimp.social.submitted', entityType: 'Lead', entityId: lead.id, after: { source: label, sessionId: session.id } } });
    return { leadId: lead.id, duplicate: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { ok: true, phase: 'SUBMITTED', leadReference: result.leadId };
}

/** A durable claim is never automatically retried after a possibly ambiguous send. */
export async function sendSocialNotice(noticeId: string, send = (message: EmailMessage) => emailProvider().send(message)) {
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ConfigurationProfile" WHERE "id"=${noticeId} FOR UPDATE`;
    const notice = await tx.configurationProfile.findUnique({ where: { id: noticeId } });
    if (!notice || notice.domain !== SOCIAL_NOTICE_DOMAIN || notice.status !== 'PENDING' || !notice.facilityId) return null;
    const state = notice.config as { connectionId: string; recipientUserId: string; channel: string };
    const connection = await tx.configurationProfile.findUnique({ where: { id: state.connectionId } });
    const parsed = socialConfig.safeParse(connection?.config);
    const recipient = await tx.user.findFirst({ where: { id: state.recipientUserId, organisationId: notice.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    const authorised = connection && connection.status === 'READY' && connection.domain === SOCIAL_INTAKE_DOMAIN && connection.organisationId === notice.organisationId && connection.facilityId === notice.facilityId && parsed.success && parsed.data.enabled && parsed.data.recipientUserId === state.recipientUserId && parsed.data.channel === state.channel && recipient && recipient.email.trim().toLowerCase() === parsed.data.recipientEmail.trim().toLowerCase() && currentRoleAccess(recipient.roleAssignments, 'leads.view', notice.facilityId).allowed;
    if (!authorised) { await tx.configurationProfile.update({ where: { id: notice.id }, data: { status: 'REVIEW_REQUIRED' } }); return null; }
    await tx.configurationProfile.update({ where: { id: notice.id }, data: { status: 'SENDING' } });
    return { organisationId: notice.organisationId, facilityId: notice.facilityId, leadId: notice.name, email: recipient.email, userId: recipient.id, channel: state.channel };
  });
  if (!claim) return;
  let accepted = false;
  try {
    const link = `https://portal.stor24.co.za/leads?lead=${encodeURIComponent(claim.leadId)}`;
    const text = `A new ${claim.channel === 'facebook' ? 'Facebook Messenger' : 'Instagram'} pricing enquiry is ready for follow-up. Open the STOR24 CRM: ${link}`;
    await send({ to: claim.email, subject: 'STOR24 pricing enquiry â€” follow-up needed', text, html: `<p>A new social media pricing enquiry is ready for follow-up.</p><p><a href="${link}">Open the STOR24 CRM</a></p>`, dlp: { organisationId: claim.organisationId, facilityId: claim.facilityId, resourceId: claim.leadId, approvedRecipient: claim.email } });
    accepted = true;
  } catch { /* The provider outcome may be ambiguous; staff review is required. */ }
  await db.configurationProfile.updateMany({ where: { id: noticeId, status: 'SENDING' }, data: { status: accepted ? 'ACCEPTED' : 'REVIEW_REQUIRED' } });
  await db.auditEvent.create({ data: { organisationId: claim.organisationId, facilityId: claim.facilityId, action: 'whatchimp.social.notice', entityType: 'Lead', entityId: claim.leadId, after: { providerAccepted: accepted, inboxVerified: false } } });
}
export async function processSocialNotices(organisationId: string) {
  const notices = await db.configurationProfile.findMany({ where: { organisationId, domain: SOCIAL_NOTICE_DOMAIN, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 10, select: { id: true } });
  let errors = 0;
  for (const notice of notices) { try { await sendSocialNotice(notice.id); } catch { errors++; } }
  return { checked: notices.length, errors };
}
