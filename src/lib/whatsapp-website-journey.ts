import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';
import { leadAttributionSchema, type LeadAttribution } from './lead-attribution';
import { intakeConfigSchema, keyHash, WHAT_CHIMP_BOT, WHAT_CHIMP_DOMAIN } from './whatchimp-enquiry-contract';

const DOMAIN = 'WHATSAPP_WEBSITE_JOURNEY';
const TTL_MS = 24 * 60 * 60 * 1000;

export async function resolveWebsiteIntake() {
  const connections = await db.configurationProfile.findMany({
    where: {
      domain: WHAT_CHIMP_DOMAIN, name: `bot${WHAT_CHIMP_BOT}`, status: 'READY',
      facility: { active: true, publicSlug: 'midpoint', publicBookingEnabled: true },
    },
    take: 2,
  });
  const connection = connections.length === 1 ? connections[0] : undefined;
  const config = intakeConfigSchema.safeParse(connection?.config);
  if (!connection?.facilityId || !config.success || !config.data.enabled || config.data.facilityId !== connection.facilityId) return null;
  return { id: connection.id, organisationId: connection.organisationId, facilityId: connection.facilityId, keyHash: config.data.keyHash };
}

export function websiteJourneyReference(message?: string) {
  return message?.match(/\bSTOR24-REF-([a-f0-9]{32})\b/i)?.[1]?.toLowerCase();
}

export async function issueWhatsAppJourney(attribution: LeadAttribution, now = new Date()) {
  const connection = await resolveWebsiteIntake();
  if (!connection) return null;
  const reference = randomBytes(16).toString('hex');
  const scope = { organisationId: connection.organisationId, facilityId: connection.facilityId, domain: DOMAIN };
  await db.$transaction([
    db.configurationProfile.deleteMany({ where: { ...scope, createdAt: { lte: new Date(now.getTime() - TTL_MS) } } }),
    db.configurationProfile.create({
      data: { ...scope, name: keyHash(reference), status: 'PENDING', config: attribution, createdAt: now },
    }),
  ]);
  return reference;
}

export async function attachWhatsAppJourney(
  tx: Prisma.TransactionClient,
  scope: { organisationId: string; facilityId: string },
  leadId: string,
  message: string | undefined,
  now: Date,
) {
  const reference = websiteJourneyReference(message);
  if (!reference) return false;
  const existing = await tx.auditEvent.findFirst({
    where: { ...scope, action: 'lead.attribution.captured', entityType: 'Lead', entityId: leadId },
    select: { id: true },
  });
  if (existing) return false;
  const pending = await tx.configurationProfile.findFirst({
    where: {
      ...scope, domain: DOMAIN, name: keyHash(reference), status: 'PENDING',
      createdAt: { gt: new Date(now.getTime() - TTL_MS), lte: now },
    },
    select: { id: true, config: true },
  });
  const attribution = leadAttributionSchema.safeParse(pending?.config);
  if (!pending || !attribution.success) return false;
  const removed = await tx.configurationProfile.deleteMany({ where: { id: pending.id, status: 'PENDING' } });
  if (removed.count !== 1) return false;
  await tx.auditEvent.create({
    data: { ...scope, action: 'lead.attribution.captured', entityType: 'Lead', entityId: leadId,
      after: { source: 'WHATSAPP_WEBSITE_JOURNEY', attribution: attribution.data },
    },
  });
  return true;
}
