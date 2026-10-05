import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAlertRecipients } from '../src/lib/operations-alert-policy.mjs';
import { encryptRecipients, decryptRecipients, loadAlertRecipients } from '../scripts/load-alert-recipients.mjs';
import { deliverAlert } from '../scripts/send-production-alert.mjs';
const key = 'a'.repeat(64);
const row = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic owner', email: 'owner@example.invalid', mobile: '+12025550100', channels: ['EMAIL', 'SMS', 'WHATSAPP'], enabled: true, consent: true };
test('recipient policy prevents disabling the entire team, unconsented sends and duplicate delivery', () => {
  assert.throws(() => validateAlertRecipients([]));
  assert.throws(() => validateAlertRecipients([{ ...row, enabled: false }]));
  assert.throws(() => validateAlertRecipients([{ ...row, consent: false }]));
  assert.throws(() => validateAlertRecipients([row, { ...row, id: '00000000-0000-4000-8000-000000000002' }]));
  assert.throws(() => validateAlertRecipients([{ ...row, mobile: '0817088120' }]));
  assert.throws(() => validateAlertRecipients([{ ...row, providerKey: 'unexpected' }]));
  assert.equal(validateAlertRecipients([{ ...row, email: ' OWNER@example.invalid ' }])[0].email, row.email);
});
test('cached recipients are authenticated encrypted and bounded by age', () => {
  const now = Date.now(), encrypted = encryptRecipients([row], key, now);
  assert.doesNotMatch(encrypted, /example.invalid|Synthetic|1202555/);
  assert.deepEqual(decryptRecipients(encrypted, key, now), [row]);
  assert.throws(() => decryptRecipients(encrypted, 'b'.repeat(64), now));
  assert.throws(() => decryptRecipients(encrypted, key, now + 31 * 86400_000));
  const altered = JSON.parse(encrypted); altered.data = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptRecipients(JSON.stringify(altered), key, now));
});
test('website failure uses encrypted last-known team; unavailable or invalid cache retains emergency recipients', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stor24-alert-cache-')), file = join(dir, 'config.enc');
  try {
    const live = await loadAlertRecipients({ STOR24_ALERT_CONFIG_KEY: key }, async (url, options) => {
      assert.equal(url, 'https://portal.stor24.co.za/api/v1/operations/alert-monitor-config');
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ data: { recipients: [row] } }));
    }, file);
    assert.equal(live.source, 'SAVED_RECIPIENTS');
    const failed = async () => { throw Error('synthetic outage'); };
    assert.deepEqual((await loadAlertRecipients({ STOR24_ALERT_CONFIG_KEY: key }, failed, file)).recipients, [row]);
    await writeFile(file, 'corrupt');
    assert.equal((await loadAlertRecipients({ STOR24_ALERT_CONFIG_KEY: key }, failed, file)).source, 'EMERGENCY_DEFAULTS');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('saved recipient channel selections and pauses control actual provider destinations', async () => {
  const recipients = [row, { ...row, id: '00000000-0000-4000-8000-000000000002', email: 'second@example.invalid', mobile: '', channels: ['EMAIL'] }, { ...row, id: '00000000-0000-4000-8000-000000000003', enabled: false }];
  const requests = [];
  const results = await deliverAlert({ ALERT_RECIPIENTS_JSON: JSON.stringify(recipients), SENDGRID_API_KEY: 'synthetic', EMAIL_FROM: 'sender@example.invalid', TWILIO_ACCOUNT_SID: 'synthetic', TWILIO_AUTH_TOKEN: 'synthetic', TWILIO_SMS_FROM: '+12025550101', TWILIO_WHATSAPP_FROM: '+12025550102', ALERT_WHATSAPP_CONTENT_SID: 'HX' + 'a'.repeat(32), READINESS_RESULT: 'failure', BACKUP_RESULT: 'success' }, 'FAILURE', async (url, options) => {
    if (url.includes('ApprovalRequests')) return new Response(JSON.stringify({ whatsapp: { status: 'approved' } }));
    requests.push({ url, options });
    return url.includes('sendgrid') ? new Response(null, { status: 202 }) : new Response(JSON.stringify({ sid: 'synthetic', status: 'queued' }), { status: 201 });
  });
  assert.equal(requests.length, 4); assert.equal(results.length, 4); assert.ok(results.every(r => r.accepted));
  assert.doesNotMatch(JSON.stringify(results), /example.invalid|1202555|Synthetic/);
  const destinations = requests.filter(r => r.url.includes('sendgrid')).map(r => JSON.parse(r.options.body).personalizations[0].to[0].email);
  assert.deepEqual(destinations.sort(), [row.email, 'second@example.invalid'].sort());
});
