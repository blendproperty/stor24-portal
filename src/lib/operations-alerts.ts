import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { validateAlertRecipients } from './operations-alert-policy.mjs';

const profileId = (organisationId: string) => `operations-alerts-${createHash('sha256').update(organisationId).digest('hex')}`;
export async function readOperationsAlerts(organisationId: string) {
  const profile = await db.configurationProfile.findFirst({ where: { id: profileId(organisationId), organisationId, domain: 'OPERATIONS_ALERTS' } });
  if (!profile) return { recipients: [], revision: null };
  const config = profile.config as { recipients?: unknown };
  return { recipients: validateAlertRecipients(config.recipients), revision: profile.updatedAt.toISOString() };
}

export async function saveOperationsAlerts(organisationId: string, actorId: string, recipients: unknown, revision: string | null) {
  const validated = validateAlertRecipients(recipients);
  const id = profileId(organisationId);
  return db.$transaction(async tx => {
    const existing = await tx.configurationProfile.findFirst({ where: { id, organisationId } });
    if ((existing?.updatedAt.toISOString() ?? null) !== revision) throw new Error('ALERT_CONFIG_CONFLICT');
    const data = { config: { recipients: validated }, status: 'ACTIVE', updatedAt: new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1)) };
    if (existing) {
      // Compare inside the write as well: another owner may save after this read.
      const changed = await tx.configurationProfile.updateMany({ where: { id, organisationId, updatedAt: existing.updatedAt }, data });
      if (changed.count !== 1) throw new Error('ALERT_CONFIG_CONFLICT');
    } else await tx.configurationProfile.create({ data: { id, organisationId, domain: 'OPERATIONS_ALERTS', name: 'Operations alert recipients', ...data } });
    await tx.auditEvent.create({ data: { organisationId, actorId, action: 'operations.alert_recipients.updated', entityType: 'ConfigurationProfile', entityId: id,
      before: { recipientCount: existing && Array.isArray((existing.config as { recipients?: unknown }).recipients) ? ((existing.config as { recipients: unknown[] }).recipients).length : 0 },
      after: { recipientCount: validated.length, activeCount: validated.filter(r => r.enabled).length } } });
    const saved = await tx.configurationProfile.findUniqueOrThrow({ where: { id } });
    return { recipients: validated, revision: saved.updatedAt.toISOString() };
  });
}
