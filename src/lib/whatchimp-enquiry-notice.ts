import { db } from '@/lib/db';
import { currentRoleAccess } from '@/lib/current-role-access';
import { emailProvider, type EmailMessage } from '@/lib/email';
import { intakeConfigSchema, WHAT_CHIMP_DOMAIN, WHAT_CHIMP_NOTICE } from '@/lib/whatchimp-enquiry-contract';

// Never automatically retry an ambiguous delivery after the provider has been called.
export async function sendWhatChimpNotice(noticeId: string, send = (message: EmailMessage) => emailProvider().send(message)) {
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ConfigurationProfile" WHERE "id"=${noticeId} FOR UPDATE`;
    const notice = await tx.configurationProfile.findUnique({ where: { id: noticeId } });
    if (!notice || notice.domain !== WHAT_CHIMP_NOTICE || notice.status !== 'PENDING' || !notice.facilityId) return null;
    const state = notice.config as { connectionId: string; recipientUserId: string };
    const connection = await tx.configurationProfile.findUnique({ where: { id: state.connectionId } });
    const config = intakeConfigSchema.safeParse(connection?.config);
    const recipient = await tx.user.findFirst({ where: { id: state.recipientUserId, organisationId: notice.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    const allowed = connection && connection.status === 'READY' && connection.domain === WHAT_CHIMP_DOMAIN && connection.organisationId === notice.organisationId && connection.facilityId === notice.facilityId && config.success && config.data.enabled && config.data.recipientUserId === state.recipientUserId && recipient && recipient.email.trim().toLowerCase() === config.data.recipientEmail?.trim().toLowerCase() && currentRoleAccess(recipient.roleAssignments, 'leads.view', notice.facilityId).allowed && currentRoleAccess(recipient.roleAssignments, 'leads.manage', notice.facilityId).allowed;
    if (!allowed) { await tx.configurationProfile.update({ where: { id: notice.id }, data: { status: 'REVIEW_REQUIRED' } }); return null; }
    await tx.configurationProfile.update({ where: { id: notice.id }, data: { status: 'SENDING' } });
    return { organisationId: notice.organisationId, facilityId: notice.facilityId, leadId: notice.name, email: recipient.email };
  });
  if (!claim) return;
  let accepted = false;
  try {
    const link = `https://portal.stor24.co.za/leads?lead=${encodeURIComponent(claim.leadId)}`;
    await send({ to: claim.email, subject: 'STOR24 WhatsApp enquiry — follow-up needed', text: `A new WhatsApp enquiry is ready for follow-up. Open the STOR24 CRM: ${link}`, html: `<p>A new WhatsApp enquiry is ready for follow-up.</p><p><a href="${link}">Open the STOR24 CRM</a></p>`, dlp: { organisationId: claim.organisationId, facilityId: claim.facilityId, resourceId: claim.leadId, approvedRecipient: claim.email } });
    accepted = true;
  } catch { /* An uncertain provider outcome needs staff review. */ }
  await db.configurationProfile.updateMany({ where: { id: noticeId, status: 'SENDING' }, data: { status: accepted ? 'ACCEPTED' : 'REVIEW_REQUIRED' } });
  await db.auditEvent.create({ data: { organisationId: claim.organisationId, facilityId: claim.facilityId, action: 'whatchimp.enquiry.notice', entityType: 'Lead', entityId: claim.leadId, after: { providerAccepted: accepted, inboxVerified: false } } });
}

export async function processWhatChimpNotices(organisationId: string) {
  const notices = await db.configurationProfile.findMany({ where: { organisationId, domain: WHAT_CHIMP_NOTICE, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 10, select: { id: true } });
  let errors = 0;
  for (const notice of notices) { try { await sendWhatChimpNotice(notice.id); } catch { errors++; } }
  const review = await db.configurationProfile.count({ where: { organisationId, domain: WHAT_CHIMP_NOTICE, OR: [{ status: 'REVIEW_REQUIRED' }, { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] } });
  return { checked: notices.length, errors, review };
}
