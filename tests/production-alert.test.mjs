import nodemailer from 'nodemailer';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { notificationKind, deliverAlert, run } from '../scripts/send-production-alert.mjs';
const env = { READINESS_RESULT: 'success', BACKUP_RESULT: 'success', ALERT_EMAIL_TO: 'test@example.invalid', EMAIL_FROM: 'STOR24 <sender@example.invalid>', HOSTINGER_SMTP_PASSWORD: 'synthetic', TWILIO_ACCOUNT_SID: 'synthetic', TWILIO_AUTH_TOKEN: 'synthetic', TWILIO_SMS_FROM: '+12025550100', TWILIO_WHATSAPP_FROM: '+12025550101', ALERT_SMS_TO: '+12025550102', ALERT_WHATSAPP_TO: '+12025550102', ALERT_WHATSAPP_CONTENT_SID: 'HX' + 'a'.repeat(32) };
beforeEach(t => t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, async sendMail(message) { return { accepted: [message.to], rejected: [] }; } })));

test('healthy silence, failed checks and recovery are distinct', () => {
  assert.equal(notificationKind({ readiness: 'success', backup: 'success' }, null), null);
  assert.equal(notificationKind({ readiness: 'failure', backup: 'success' }, null), 'FAILURE');
  assert.equal(notificationKind({ readiness: 'success', backup: 'success' }, { conclusion: 'failure' }), 'RECOVERY');
  assert.equal(notificationKind({ readiness: 'success', backup: 'success' }, null, true), 'TEST');
});
test('pending WhatsApp approval prevents sending, without blocking email or SMS', async t => {
  const requests = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, async sendMail(message) { requests.push({ options: { method: 'POST' }, message }); return { accepted: [message.to] }; } }));
  const results = await deliverAlert(env, 'TEST', async (url, options) => {
    requests.push({ url, options });
    if (url.includes('ApprovalRequests')) return { ok: true, json: async () => ({ whatsapp: { status: 'pending' } }) };
    return { ok: true, status: url.includes('sendgrid') ? 202 : 201, json: async () => ({ sid: 'synthetic', status: 'queued' }) };
  });
  assert.equal(requests.filter(r => r.options.method === 'POST').length, 2);
  assert.equal(results[2].status, 'TEMPLATE_NOT_APPROVED');
  assert.doesNotMatch(JSON.stringify(results), /example.invalid|synthetic.*synthetic/);
});
test('uncertain sends are not retried and do not prevent remaining channels', async t => {
  let attempts = 0;
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, async sendMail() { attempts++; throw Error('private SMTP response'); } }));
  const results = await deliverAlert(env, 'TEST', async () => { attempts++; throw new Error('sensitive provider response'); });
  assert.equal(attempts, 3);
  assert.equal(results[0].status, 'UNCERTAIN');
  assert.doesNotMatch(JSON.stringify(results), /sensitive|example.invalid/);
});
test('approved WhatsApp uses content template, never an authentication template or free text', async () => {
  let whatsapp;
  await deliverAlert(env, 'FAILURE', async (url, options) => {
    if (url.includes('ApprovalRequests')) return { ok: true, json: async () => ({ whatsapp: { status: 'approved' } }) };
    if (options.body instanceof URLSearchParams && options.body.get('To').startsWith('whatsapp:')) whatsapp = options.body;
    return { ok: true, status: 202, json: async () => ({ status: 'queued' }) };
  });
  assert.equal(whatsapp.get('ContentSid'), env.ALERT_WHATSAPP_CONTENT_SID);
  assert.equal(whatsapp.has('Body'), false);
});
test('rerunning the same workflow never repeats messages', async () => {
  const result = await run({ GITHUB_RUN_ATTEMPT: '2' }, () => { throw Error('must not call provider'); });
  assert.equal(result.status, 'SKIPPED_REPLAY');
});
test('sender failure cannot manufacture a recovery notification', async () => {
  const result = await run({ READINESS_RESULT: 'success', BACKUP_RESULT: 'success', GITHUB_RUN_ID: '10' }, async url => ({ ok: true, json: async () => url.includes('/jobs') ? { jobs: [{ name: 'readiness', conclusion: 'success' }, { name: 'backup', conclusion: 'success' }, { name: 'alerts', conclusion: 'failure' }] } : { workflow_runs: [{ id: 9, conclusion: 'failure' }] } }));
  assert.equal(result.status, 'HEALTHY_NO_NOTIFICATION');
});
test('persistent outage is suppressed after a recent delivery attempt, including a partially failed one', async () => {
  const result = await run({ READINESS_RESULT: 'failure', BACKUP_RESULT: 'success', GITHUB_RUN_ID: '10' }, async url => ({ ok: true, json: async () => url.includes('/jobs') ? { jobs: [{ name: 'readiness', conclusion: 'failure' }, { name: 'backup', conclusion: 'success' }, { name: 'alerts', status: 'completed', conclusion: 'failure' }] } : { workflow_runs: [{ id: 9, created_at: new Date().toISOString() }] } }));
  assert.equal(result.status, 'SUPPRESSED');
});
test('a recent healthy test cannot suppress the first real incident', async () => {
  const result = await run({ READINESS_RESULT: 'failure', BACKUP_RESULT: 'success', GITHUB_RUN_ID: '10' }, async url => ({ ok: true, json: async () => url.includes('/jobs') ? { jobs: [{ name: 'readiness', conclusion: 'success' }, { name: 'backup', conclusion: 'success' }, { name: 'alerts', status: 'completed', conclusion: 'success' }] } : { workflow_runs: [{ id: 9, created_at: new Date().toISOString() }] } }));
  assert.equal(result.status, 'ATTEMPTED');
});


test('SMTP uses verified TLS, fixed sender and single recipients; authentication errors are redacted and never replayed', async t => {
  let sends = 0, closes = 0;
  t.mock.method(nodemailer, 'createTransport', options => {
    assert.equal(options.host, 'smtp.hostinger.com'); assert.equal(options.secure, true);
    assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.auth.user, 'bookings@stor24.co.za');
    return { close() { closes++; }, async sendMail(message) {
      sends++; assert.equal(message.from.address, 'bookings@stor24.co.za');
      assert.deepEqual(message.envelope.to, [env.ALERT_EMAIL_TO]);
      throw Object.assign(Error('private PASSWORD recipient@example.invalid'), { code: 'EAUTH' });
    } };
  });
  const result = await deliverAlert({ ...env, ALERT_CHANNELS: 'EMAIL' }, 'TEST');
  assert.equal(sends, 1); assert.equal(closes, 1); assert.equal(result[0].status, 'AUTHENTICATION_FAILED');
  assert.equal(result[0].automaticRetry, false); assert.doesNotMatch(JSON.stringify(result), /PASSWORD|example.invalid/);
});

test('SMTP rejection and invalid recipients cannot report successful email acceptance', async t => {
  let calls = 0;
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, async sendMail() { calls++; return { accepted: [], rejected: ['private'] }; } }));
  const rejected = await deliverAlert({ ...env, ALERT_CHANNELS: 'EMAIL' }, 'TEST');
  assert.equal(rejected[0].accepted, false);
  const invalid = await deliverAlert({ ...env, ALERT_CHANNELS: 'EMAIL', ALERT_EMAIL_TO: 'invalid\r\nBcc:person@example.invalid' }, 'TEST');
  assert.equal(invalid[0].status, 'INVALID_RECIPIENT'); assert.equal(calls, 1);
});

test('real run enrichment includes the exact readiness failure and keeps backup evidence if log fetch fails', async t => {
  let body;
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, async sendMail(message) { body = message.text; return { accepted: [message.to] }; } }));
  const result = await run({ ...env, READINESS_RESULT: 'failure', GITHUB_RUN_ID: '10', GITHUB_REPOSITORY: 'blendproperty/stor24-portal', ALERT_CHANNELS: 'EMAIL' }, async url => {
    if (url.includes('/workflows/')) return new Response(JSON.stringify({ workflow_runs: [] }));
    if (url.includes('/runs/10/jobs')) return new Response(JSON.stringify({ jobs: [{ id: 20, name: 'readiness', steps: [{ name: 'Verify Cloudflare origin protection cannot be bypassed directly', conclusion: 'failure' }] }, { id: 21, name: 'backup' }] }));
    if (url.includes('/jobs/20/logs')) return new Response('STOR24_ORIGIN_UNVERIFIED host=cms.stor24.co.za probe=plain curl=28 attempts=3\n');
    throw Error('PRIVATE_ACCESS_ERROR');
  });
  assert.equal(result.severity, 'WARNING'); assert.match(body, /cms.stor24.co.za.*curl 28/);
  assert.doesNotMatch(body, /PRIVATE_ACCESS_ERROR/);
});
