import { z } from 'zod';

export const SOCIAL_INTAKE_DOMAIN = 'WHATCHIMP_SOCIAL_INTAKE';
export const SOCIAL_SESSION_DOMAIN = 'WHATCHIMP_SOCIAL_SESSION';
export const SOCIAL_NOTICE_DOMAIN = 'WHATCHIMP_SOCIAL_NOTICE';
export const socialConfig = z.object({ enabled: z.boolean(), channel: z.enum(['facebook', 'instagram']), botId: z.string().regex(/^\d{1,30}$/), keyHash: z.string().regex(/^[a-f0-9]{64}$/), facilityId: z.string().min(1), recipientUserId: z.string().min(1) }).strict();

/** Format check, not proof that a number exists or belongs to the sender. */
export function normalizeSocialPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^[+\d\s().-]+$/.test(trimmed) || (trimmed.match(/\+/g)?.length ?? 0) > 1 || (trimmed.includes('+') && !trimmed.startsWith('+'))) return null;
  const value = trimmed.replace(/[\s().-]/g, '');
  let digits = value.replace(/^\+/, '');
  if (!value.startsWith('+') && !/^0[1-9]\d{8}$/.test(digits) && !/^27[1-9]\d{8}$/.test(digits)) return null;
  if (/^0[1-9]\d{8}$/.test(digits)) digits = `27${digits.slice(1)}`;
  if (!/^[1-9]\d{7,14}$/.test(digits) || /^27/.test(digits) && !/^27[1-9]\d{8}$/.test(digits) || /^(\d)\1+$/.test(digits)) return null;
  return `+${digits}`;
}
const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !/^#[^#]+#$/.test(v), 'Unresolved provider variable');
export const socialRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('probe') }).strict(),
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('validate'), phone: z.string().max(80) }).strict(),
  z.object({ action: z.literal('submit'), enquiryKey: z.uuid(), name: text(100), phone: z.string().max(80), requirements: text(500), startDate: text(100) }).strict(),
]);
export type SocialRequest = z.infer<typeof socialRequest>;
