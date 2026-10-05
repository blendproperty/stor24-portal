import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { validateAlertRecipients } from '../src/lib/operations-alert-policy.mjs';

const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000;
function keyBytes(key) {
  if (!/^[0-9a-f]{64}$/i.test(key || '')) throw Error('Invalid monitor configuration key');
  return createHash('sha256').update('stor24-alert-recipient-cache-v1:').update(key).digest();
}
export function encryptRecipients(recipients, key, now = Date.now()) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv, { authTagLength: 16 });
  const plaintext = JSON.stringify({ savedAt: now, recipients: validateAlertRecipients(recipients) });
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
export function decryptRecipients(text, key, now = Date.now()) {
  if (text.length > 64_000) throw Error('Cache too large');
  const cache = JSON.parse(text);
  if (cache.version !== 1) throw Error('Unsupported cache');
  const iv = Buffer.from(cache.iv, 'base64'), tag = Buffer.from(cache.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw Error('Invalid authenticated cache');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(cache.data, 'base64')), decipher.final()]).toString('utf8'));
  if (!Number.isSafeInteger(value.savedAt) || now - value.savedAt > MAX_CACHE_AGE || value.savedAt > now + 60_000) throw Error('Cache expired');
  return validateAlertRecipients(value.recipients);
}

export async function loadAlertRecipients(env, fetcher = fetch, file = '.operations-alert-config.enc') {
  if (!env.STOR24_ALERT_CONFIG_KEY) return { source: 'EMERGENCY_DEFAULTS', recipients: null };
  // Fixed production origin: never send the read credential to an arbitrary URL or redirect.
  try {
    const response = await fetcher('https://portal.stor24.co.za/api/v1/operations/alert-monitor-config', { headers: { Authorization: `Bearer ${env.STOR24_ALERT_CONFIG_KEY}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error('Unavailable');
    const body = await response.text();
    if (body.length > 24_000) throw Error('Response too large');
    const recipients = validateAlertRecipients(JSON.parse(body).data?.recipients);
    try {
      const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
      await writeFile(temporary, encryptRecipients(recipients, env.STOR24_ALERT_CONFIG_KEY), { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
    } catch {
      // A cache/storage fault must not resurrect an old list after a valid live read.
      return { source: 'SAVED_RECIPIENTS_NO_CACHE', recipients };
    }
    return { source: 'SAVED_RECIPIENTS', recipients };
  } catch {
    try { return { source: 'ENCRYPTED_LAST_KNOWN', recipients: decryptRecipients(await readFile(file, 'utf8'), env.STOR24_ALERT_CONFIG_KEY) }; }
    catch { return { source: 'EMERGENCY_DEFAULTS', recipients: null }; }
  }
}
