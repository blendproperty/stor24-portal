import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { leadSlaSchema, slaFromStoreHours, type LeadSlaPolicy } from './lead-sla-policy';

export const WHAT_CHIMP_BOT = '475943';
export const WHAT_CHIMP_DOMAIN = 'WHATCHIMP_INTAKE';
export const WHAT_CHIMP_SESSION = 'WHATCHIMP_ENQUIRY';
export const enquiryFields = ['use', 'items', 'start', 'duration', 'size', 'viewing', 'name'] as const;
export type EnquiryField = typeof enquiryFields[number];
const phone = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).transform(v => `+${v.replace(/^\+/, '')}`);
const answer = z.string().trim().max(500).refine(v => !/^#[^#]+#$/.test(v), 'Unresolved provider variable');
const common = { botId: z.literal(WHAT_CHIMP_BOT), phone, displayName: z.string().trim().max(100).optional() };
export const enquiryRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('start') }).strict(),
  z.object({ ...common, action: z.literal('update'), enquiryKey: z.uuid(), field: z.enum(enquiryFields), value: answer }).strict().refine(v => v.value.length > 0 && v.value.length <= ({ use: 40, items: 500, start: 100, duration: 80, size: 100, viewing: 40, name: 100 })[v.field], 'Keep this answer brief.'),
  z.object({ ...common, action: z.literal('submit'), enquiryKey: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal('route'), enquiryKey: z.preprocess(v => typeof v === 'string' && (!v.trim() || /^#[^#]+#$/.test(v)) ? undefined : v, z.uuid().optional()) }).strict(),
  z.object({ action: z.literal('probe'), botId: z.literal(WHAT_CHIMP_BOT) }).strict(),
]);
export type EnquiryRequest = z.infer<typeof enquiryRequestSchema>;
export const intakeConfigSchema = z.object({ enabled: z.boolean(), botId: z.literal(WHAT_CHIMP_BOT), keyHash: z.string().regex(/^[a-f0-9]{64}$/), facilityId: z.string().min(1) }).strict();
export function keyHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function matchesIntakeKey(value: string, hash: string) {
  if (value.length < 32 || value.length > 200 || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(keyHash(value), 'hex'), Buffer.from(hash, 'hex'));
}

/** Saved SLA policy wins; saved office hours are the fallback. Never use example hours. */
export function intakeCalendar(sla: unknown, store: unknown): LeadSlaPolicy | null {
  if (sla !== undefined && sla !== null) { const parsed = leadSlaSchema.safeParse(sla); return parsed.success ? parsed.data : null; }
  return slaFromStoreHours(store);
}
export function intakeHours(now: Date, policy: LeadSlaPolicy | null) {
  if (!policy || !Number.isFinite(now.getTime())) return { staffed: false, confirmed: false, nextOpening: null as Date | null };
  const local = new Date(now.getTime() + 2 * 3600000);
  local.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 370; i++) {
    const day = local.toISOString().slice(0, 10);
    const window = policy.windows.find(w => w.day === local.getUTCDay());
    if (window && !policy.holidays.includes(day)) {
      const opening = new Date(local.getTime() - 2 * 3600000 + window.start * 60000);
      const closing = new Date(local.getTime() - 2 * 3600000 + window.end * 60000);
      if (now >= opening && now < closing) return { staffed: true, confirmed: true, nextOpening: now };
      if (opening > now) return { staffed: false, confirmed: true, nextOpening: opening };
    }
    local.setUTCDate(local.getUTCDate() + 1);
  }
  return { staffed: false, confirmed: false, nextOpening: null as Date | null };
}
export function enquirySummary(answers: Partial<Record<EnquiryField, string>>, inbox: string, submitted: boolean) {
  const labels = { use: 'Storage use', items: 'Items / quantity', start: 'Preferred start', duration: 'Duration', size: 'Unit size', viewing: 'Viewing', name: 'Name' };
  return ['WhatsApp storage enquiry', `Status: ${submitted ? 'Submitted — staff follow-up' : 'Capture in progress'}`, ...enquiryFields.map(f => `${labels[f]}: ${answers[f] || 'Not provided yet'}`), `Conversation: ${inbox}`, 'This enquiry does not reserve a unit.'].join('\n');
}
