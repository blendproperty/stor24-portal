import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function whatChimpSigningKey(secret?: string) {
  if (!secret || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) return null;
  const key = Buffer.from(secret.slice(6), 'base64');
  return key.length >= 24 && key.length <= 64 ? key : null;
}

export function verifyWhatChimpIncoming(headers: Headers, raw: Buffer, key: Buffer, now = Date.now()) {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  if (!id || !/^evt_[A-Za-z0-9_-]{1,96}$/.test(id) || !timestamp || !/^\d{10}$/.test(timestamp)
    || Math.abs(now / 1000 - Number(timestamp)) > 300 || !signatures || signatures.length > 256) return null;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest();
  return signatures.split(' ').some(value => {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(value)) return false;
    return timingSafeEqual(expected, Buffer.from(value.slice(3), 'base64'));
  }) ? id : null;
}

const stor24Channel = z.object({ id: z.string().startsWith('ch_'), type: z.literal('whatsapp'), phone: z.literal('+27600186824') });
const messageIncoming = z.object({
  id: z.string(),
  type: z.literal('message.incoming'),
  test: z.literal(false),
  channel: stor24Channel,
  contact: z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) }),
  data: z.object({ message: z.object({
    channel: stor24Channel,
    direction: z.literal('incoming'),
    type: z.literal('text'),
    text: z.string(),
  }) }),
});

export function readWhatChimpIncoming(value: unknown, eventId: string) {
  const parsed = messageIncoming.safeParse(value);
  if (!parsed.success || parsed.data.id !== eventId || parsed.data.channel.id !== parsed.data.data.message.channel.id) return null;
  return { phone: parsed.data.contact.phone, text: parsed.data.data.message.text };
}
