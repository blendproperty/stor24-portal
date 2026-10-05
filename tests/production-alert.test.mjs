import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationKind, deliverAlert, run } from '../scripts/send-production-alert.mjs';
const env = { READINESS_RESULT: 'success', BACKUP_RESULT: 'success', ALERT_EMAIL_TO: 'test@example.invalid', EMAIL_FROM: 'STOR24 <sender@example.invalid>', SENDGRID_API_KEY: 'synthetic', TWILIO_ACCOUNT_SID: 'synthetic', TWILIO_AUTH_TOKEN: 'synthetic', TWILIO_SMS_FROM: '+12025550100', TWILIO_WHATSAPP_FROM: '+12025550101', ALERT_SMS_TO: '+12025550102', ALERT_WHATSAPP_TO: '+12025550102', ALERT_WHATSAPP_CONTENT_SID: 'HX' + 'a'.repeat(32) };
test('healthy silence, failed checks and recovery are distinct', () => {
  assert.equal(notificationKind({ readiness: 'success', backup: 'success' }, null), null);
  assert.equal(notificationKind({ readiness: 'failure', backup: 'success' }, null), 'FAILURE');
  assert.equal(notificationKind({ readiness: 'success', backup: 'success' }, { conclusion: 'failure' }), 'RECOVERY');
  assert.equal(notificationKind({ readiness: 'success', backup: 'success' }, null, true), 'TEST');
});
test('pending WhatsApp approval prevents sending, without blocking email or SMS', async () => {
  const requests = [];
  const results = await deliverAlert(env, 'TEST', async (url, options) => {
    requests.push({ url, options });
    if (url.includes('ApprovalRequests')) return { ok: true, json: async () => ({ whatsapp: { status: 'pending' } }) };
    return { ok: true, status: url.includes('sendgrid') ? 202 : 201, json: async () => ({ sid: 'synthetic', status: 'queued' }) };
  });
  assert.equal(requests.filter(r => r.options.method === 'POST').length, 2);
  assert.equal(results[2].status, 'TEMPLATE_NOT_APPROVED');
  assert.doesNotMatch(JSON.stringify(results), /example.invalid|synthetic.*synthetic/);
});
test('uncertain sends are not retried and do not prevent remaining channels', async () => {
  let attempts = 0;
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
