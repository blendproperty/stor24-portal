import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { enquiryFields, enquirySummary, intakeCalendar, intakeConfigSchema, intakeHours, WHAT_CHIMP_DOMAIN, WHAT_CHIMP_SESSION, type EnquiryField, type EnquiryRequest } from './whatchimp-enquiry-contract';

type Session = { phone: string; leadId: string; customerId: string; answers: Partial<Record<EnquiryField, string>>; submitted: boolean; generatedNotes: string; taskId?: string };
export async function resolveIntakeCalendar(organisationId: string, facilityId: string) {
  const profiles = await db.configurationProfile.findMany({ where: { organisationId, facilityId, status: 'READY', OR: [{ domain: 'LEAD_SLA', name: 'policy' }, { domain: 'STORE_INFORMATION', name: 'Default' }] }, select: { domain: true, config: true } });
  return intakeCalendar(profiles.find(p => p.domain === 'LEAD_SLA')?.config, profiles.find(p => p.domain === 'STORE_INFORMATION')?.config);
}
export async function captureWhatChimpEnquiry(connectionId: string, input: EnquiryRequest, now = new Date(), verifiedKeyHash?: string, attempt = 0): Promise<{ ok: boolean; enquiryKey?: string; leadReference?: string; routing: string; staffed: boolean; nextOpening: string | null; timezone: string; message: string }> {
  const connection = await db.configurationProfile.findUnique({ where: { id: connectionId } });
  if (!connection?.facilityId || connection.domain !== WHAT_CHIMP_DOMAIN || connection.status !== 'READY') throw Error('INTAKE_DISABLED');
  const config = intakeConfigSchema.parse(connection.config);
  if (!config.enabled || config.facilityId !== connection.facilityId || config.botId !== input.botId || verifiedKeyHash && verifiedKeyHash !== config.keyHash) throw Error('INTAKE_DISABLED');
  const organisationId = connection.organisationId, facilityId = connection.facilityId;
  const facility = await db.facility.findFirst({ where: { id: facilityId, organisationId, active: true }, select: { id: true } });
  if (!facility) throw Error('INTAKE_DISABLED');
  const hours = intakeHours(now, await resolveIntakeCalendar(organisationId, facilityId));
  const nextOpening = hours.nextOpening?.toISOString() ?? null;
  const routing = hours.staffed ? 'STAFF' : hours.confirmed ? 'AFTER_HOURS' : 'HOURS_REVIEW';
  if (input.action === 'probe') return { ok: true, enquiryKey: '00000000-0000-4000-8000-000000000000', leadReference: 'CONNECTION_TEST_ONLY', routing, staffed: hours.staffed, nextOpening, timezone: 'Africa/Johannesburg', message: 'STOR24 enquiry connection is ready. No lead was created by this connection test.' };
  const inbox = `https://app.whatchimp.com/all/livechat?subscriber_id=${input.phone.slice(1)}-${input.botId}&from_media=whatsapp`;
  try { return await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${organisationId}:${facilityId}:whatchimp:${input.phone}`}, 0))`;
    const live = await tx.configurationProfile.findUnique({ where: { id: connectionId } });
    if (!live || live.updatedAt.getTime() !== connection.updatedAt.getTime() || !intakeConfigSchema.parse(live.config).enabled) throw Error('INTAKE_DISABLED');
    const suppliedKey = 'enquiryKey' in input ? input.enquiryKey : undefined;
    let record = suppliedKey ? await tx.configurationProfile.findFirst({ where: { organisationId, facilityId, domain: WHAT_CHIMP_SESSION, name: suppliedKey } }) : await tx.configurationProfile.findFirst({ where: { organisationId, facilityId, domain: WHAT_CHIMP_SESSION, ...(input.action === 'route' ? {} : { status: 'CAPTURING' }), config: { path: ['phone'], equals: input.phone } }, orderBy: { createdAt: 'desc' } });
    if (suppliedKey && (!record || (record.config as unknown as Session).phone !== input.phone)) throw Error('INTAKE_NOT_FOUND');
    if (!record && input.action === 'update') throw Error('INTAKE_NOT_FOUND');
    if (!record && input.action === 'submit') throw Error('INTAKE_NOT_FOUND');
    if (!record) {
      const earlier = await tx.configurationProfile.findFirst({ where: { organisationId, facilityId, domain: WHAT_CHIMP_SESSION, config: { path: ['phone'], equals: input.phone } }, orderBy: { createdAt: 'desc' } });
      const prior = earlier?.config as Session | undefined;
      const reusable = prior ? await tx.customer.findFirst({ where: { id: prior.customerId, organisationId, phone: input.phone, phoneVerifiedAt: null, tenancies: { none: {} }, reservations: { none: {} } } }) : null;
      // A previous bot-created prospect may be reused. Never infer tenant identity from a phone match.
      const customer = reusable ?? await tx.customer.create({ data: { organisationId, firstName: input.displayName || 'WhatsApp enquiry', phone: input.phone, communicationConsent: { source: 'WHATCHIMP_STORAGE_ENQUIRY', purpose: 'RESPOND_TO_ENQUIRY', recordedAt: now.toISOString(), whatsapp: true, email: false, sms: false, phone: false } } });
      const lead = await tx.lead.create({ data: { facilityId, customerId: customer.id, source: 'WhatsApp', stage: 'NEW', nextActionAt: hours.nextOpening } });
      const state: Session = { phone: input.phone, leadId: lead.id, customerId: customer.id, answers: {}, submitted: false, generatedNotes: '' };
      record = await tx.configurationProfile.create({ data: { organisationId, facilityId, domain: WHAT_CHIMP_SESSION, name: randomUUID(), status: 'CAPTURING', config: state as unknown as Prisma.InputJsonValue } });
      await tx.auditEvent.create({ data: { organisationId, facilityId, action: 'whatchimp.enquiry.started', entityType: 'Lead', entityId: lead.id, after: { source: 'WhatsApp', stage: 'NEW', sessionId: record.id, routing } } });
      await tx.auditEvent.create({ data: { organisationId, facilityId, action: 'lead.created', entityType: 'Lead', entityId: lead.id, after: { source: 'WhatsApp', stage: 'NEW', customerId: customer.id, customerCreated: !reusable } } });
    }
    const state = record.config as unknown as Session;
    const previousState = JSON.stringify(state);
    const lead = await tx.lead.findFirst({ where: { id: state.leadId, facilityId, customerId: state.customerId, facility: { organisationId } }, select: { id: true, notes: true, stage: true, reservations: { select: { id: true }, take: 1 } } });
    if (!lead) throw Error('INTAKE_NOT_FOUND');
    if (input.action === 'update') {
      if (state.submitted) { if (state.answers[input.field] !== input.value) throw Error('INTAKE_SUBMITTED'); }
      else state.answers[input.field] = input.value;
    }
    const submitting = input.action === 'submit' || input.action === 'route';
    const firstSubmit = submitting && !state.submitted;
    if (input.action === 'submit' && enquiryFields.some(f => !state.answers[f])) throw Error('INTAKE_INCOMPLETE');
    if (submitting) state.submitted = true;
    const generatedNotes = enquirySummary(state.answers, inbox, state.submitted);
    const staffNotes = state.generatedNotes && lead.notes?.startsWith(state.generatedNotes) ? lead.notes.slice(state.generatedNotes.length).trimStart() : lead.notes ?? '';
    const notes = staffNotes ? `${generatedNotes}\n\n${staffNotes}` : generatedNotes;
    if (notes.length > 2000) throw Error('INTAKE_NOTES_REVIEW');
    if (notes !== lead.notes) await tx.lead.update({ where: { id: lead.id }, data: { notes, ...(lead.stage === 'NEW' && !lead.reservations.length ? { nextActionAt: hours.nextOpening } : {}) } });
    state.generatedNotes = generatedNotes;
    if (state.answers.name && !state.submitted) await tx.customer.updateMany({ where: { id: state.customerId, organisationId, firstName: 'WhatsApp enquiry', phoneVerifiedAt: null, tenancies: { none: {} }, reservations: { none: {} } }, data: { firstName: state.answers.name.slice(0, 100) } });
    if (firstSubmit) {
      const task = await tx.task.create({ data: { organisationId, facilityId, customerId: state.customerId, title: 'WhatsApp storage enquiry — staff follow-up', description: `Review the enquiry in lead to lease: /leads?lead=${encodeURIComponent(lead.id)}\n${inbox}\n${routing === 'STAFF' ? 'Requested during saved working hours.' : 'Queued for the next staffed period.'}`, dueAt: hours.nextOpening } });
      state.taskId = task.id;
      await tx.auditEvent.create({ data: { organisationId, facilityId, action: 'whatchimp.enquiry.submitted', entityType: 'Lead', entityId: lead.id, after: { routing, nextActionAt: nextOpening, taskId: task.id, fieldCount: Object.keys(state.answers).length } } });
    }
    if (JSON.stringify(state) !== previousState) {
      await tx.configurationProfile.update({ where: { id: record.id }, data: { status: state.submitted ? 'SUBMITTED' : 'CAPTURING', config: state as unknown as Prisma.InputJsonValue } });
      if (input.action === 'update') await tx.auditEvent.create({ data: { organisationId, facilityId, action: 'whatchimp.enquiry.answer_saved', entityType: 'Lead', entityId: lead.id, after: { field: input.field, fieldCount: Object.keys(state.answers).length } } });
    }
    const message = !state.submitted ? 'Your enquiry details have been saved.' : hours.staffed ? 'Your enquiry has been saved in STOR24. You can now request our team in this chat. A staff member will reply when available.' : hours.confirmed ? 'Your enquiry has been saved in STOR24. Our team is currently offline and will follow up during the next working hours. You can continue using the storage menu or book online.' : 'Your enquiry has been saved in STOR24 for staff follow-up. We cannot confirm staffed hours right now. You can continue using the storage menu.';
    return { ok: true, enquiryKey: record.name, leadReference: lead.id, routing, staffed: hours.staffed, nextOpening, timezone: 'Africa/Johannesburg', message };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034' && attempt < 2) return captureWhatChimpEnquiry(connectionId, input, now, verifiedKeyHash, attempt + 1); throw e; }
}
