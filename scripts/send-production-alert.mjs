import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateAlertRecipients } from '../src/lib/operations-alert-policy.mjs';
import { loadAlertRecipients } from './load-alert-recipients.mjs';
import { HOSTINGER_EMAIL_ADDRESS, hostingerTransport } from '../src/lib/hostinger-transport.mjs';
import { alertDetails } from './production-alert-details.mjs';

const SUCCESS = 'success';
export const OWNER_EMAIL_TEST_RUN_NAME = 'STOR24 owner email delivery test';
export function ownerEmailTestEnvironment(env) {
  if (!['', 'false', 'true'].includes(env.ALERT_OWNER_EMAIL_TEST || '')) throw Error('Invalid owner email test mode');
  if (env.ALERT_OWNER_EMAIL_TEST !== 'true') return null;
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw Error('Owner email test requires manual dispatch');
  // Fixed destination and an allowlist prevent saved routing or phone credentials entering this test.
  const scoped = { ALERT_OWNER_EMAIL_TEST: 'true', ALERT_TEST: 'true', ALERT_CHANNELS: 'EMAIL', ALERT_EMAIL_TO: 'brettd@blendproperty.co.za' };
  for (const name of ['GITHUB_EVENT_NAME', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'READINESS_RESULT', 'BACKUP_RESULT', 'HOSTINGER_SMTP_PASSWORD']) scoped[name] = env[name];
  return scoped;
}
export async function prepareAlertEnvironment(env, load = loadAlertRecipients) {
  const scoped = ownerEmailTestEnvironment(env);
  if (scoped) return { source: 'OWNER_EMAIL_TEST', env: scoped };
  const configuration = await load(env);
  return { source: configuration.source, env: configuration.recipients ? { ...env, ALERT_RECIPIENTS_JSON: JSON.stringify(configuration.recipients) } : env };
}
export function notificationKind(current, previous, test = false) {
  if (test) return 'TEST';
  if (current.readiness !== SUCCESS || current.backup !== SUCCESS) return 'FAILURE';
  if (previous && previous.conclusion !== SUCCESS) return 'RECOVERY';
  return null;
}

export async function deliverAlert(env, kind, fetcher = fetch) {
  const scoped = ownerEmailTestEnvironment(env);
  if (scoped && kind !== 'TEST') throw Error('Owner email test requires TEST label');
  env = scoped || env;
  if (!env.ALERT_RECIPIENTS_JSON) return deliverDestinations(env, kind, fetcher);
  const recipients = validateAlertRecipients(JSON.parse(env.ALERT_RECIPIENTS_JSON)).filter(r => r.enabled);
  const results = [];
  // Four recipients at a time bounds provider concurrency and total dispatch time.
  for (let offset = 0; offset < recipients.length; offset += 4) {
    const batch = await Promise.all(recipients.slice(offset, offset + 4).map(async recipient => {
      const channels = await deliverDestinations({ ...env, ALERT_CHANNELS: recipient.channels.join(','), ALERT_EMAIL_TO: recipient.email, ALERT_SMS_TO: recipient.mobile, ALERT_WHATSAPP_TO: recipient.mobile }, kind, fetcher);
      return channels.map(result => ({ ...result, recipientRef: createHash('sha256').update(recipient.id).digest('hex').slice(0, 12) }));
    }));
    results.push(...batch.flat());
  }
  return results;
}

async function deliverDestinations(env, kind, fetcher) {
  const results = [];
  const allowed = env.ALERT_CHANNELS === undefined ? ['EMAIL', 'SMS', 'WHATSAPP'] : env.ALERT_CHANNELS.split(',');
  const detail = alertDetails(env, kind);
  const text = detail.text;
  const request = async (channel, url, options) => {
    try {
      const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      return { channel, accepted: response.ok, httpStatus: response.status, status: data.status, code: data.code, reference: response.ok ? data.sid : undefined };
    } catch {
      // An uncertain provider result must never be automatically replayed.
      return { channel, accepted: false, status: 'UNCERTAIN', automaticRetry: false };
    }
  };
  const emails = (env.ALERT_EMAIL_TO || '').split(',').map(x => x.trim()).filter(Boolean);
  if (allowed.includes('EMAIL')) {
    if (!emails.length || !env.HOSTINGER_SMTP_PASSWORD) results.push({ channel: 'EMAIL', accepted: false, status: 'CONFIG_REQUIRED' });
    else for (const email of emails) {
      if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) {
        results.push({ channel: 'EMAIL', accepted: false, status: 'INVALID_RECIPIENT' }); continue;
      }
      let transport;
      try {
        transport = hostingerTransport(env);
        const result = await transport.sendMail({
          from: { name: 'Stor24', address: HOSTINGER_EMAIL_ADDRESS },
          envelope: { from: HOSTINGER_EMAIL_ADDRESS, to: [email] }, to: email,
          subject: `STOR24 ${kind} ALERT - ${detail.severity}`, text, html: detail.html,
          disableFileAccess: true, disableUrlAccess: true,
        });
        results.push({ channel: 'EMAIL', accepted: result.accepted?.length === 1 && !result.rejected?.length, status: 'SMTP_RESPONSE' });
      } catch (error) {
        // Authentication rejection is definite; all other send errors may follow acceptance. Never replay.
        results.push({ channel: 'EMAIL', accepted: false, status: error?.code === 'EAUTH' ? 'AUTHENTICATION_FAILED' : 'UNCERTAIN', automaticRetry: false });
      } finally { transport?.close(); }
    }
  }
  const auth = `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
  for (const channel of ['SMS', 'WHATSAPP']) {
    if (!allowed.includes(channel)) continue;
    const to = env[`ALERT_${channel}_TO`];
    const from = env[`TWILIO_${channel}_FROM`];
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !from || !/^\+[1-9]\d{7,14}$/.test(to || '')) {
      results.push({ channel, accepted: false, status: 'CONFIG_REQUIRED' }); continue;
    }
    let fields = { To: to, From: from, Body: text };
    if (channel === 'WHATSAPP') {
      const sid = env.ALERT_WHATSAPP_CONTENT_SID;
      if (!/^HX[0-9a-f]{32}$/i.test(sid || '')) { results.push({ channel, accepted: false, status: 'TEMPLATE_REQUIRED' }); continue; }
      try {
        const approval = await fetcher(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(15000) });
        const value = await approval.json();
        if (!approval.ok || value.whatsapp?.status !== 'approved') { results.push({ channel, accepted: false, status: 'TEMPLATE_NOT_APPROVED' }); continue; }
      } catch { results.push({ channel, accepted: false, status: 'APPROVAL_CHECK_FAILED' }); continue; }
      fields = { To: `whatsapp:${to}`, From: `whatsapp:${from.replace(/^whatsapp:/, '')}`, ContentSid: sid,
        ContentVariables: JSON.stringify({ '1': `${kind} (${detail.severity})`, '2': detail.summary, '3': detail.time }) };
    }
    results.push(await request(channel, `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
    }));
  }
  return results;
}

export async function run(env, fetcher = fetch) {
  if (Number(env.GITHUB_RUN_ATTEMPT || '1') > 1) return { status: 'SKIPPED_REPLAY', reason: 'Use a fresh explicit test run; provider requests are not replayed.' };
  env = ownerEmailTestEnvironment(env) || env;
  const current = { readiness: env.READINESS_RESULT, backup: env.BACKUP_RESULT };
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
  const api = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  const get = async url => { const r = await fetcher(url, { headers, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('Monitor history unavailable'); return r.json(); };
  const history = await get(`${api}/actions/workflows/monitor-production.yml/runs?status=completed&per_page=10`);
  // Delivery tests must not create recovery notifications or consume a real incident's cooldown.
  history.workflow_runs = history.workflow_runs?.filter(r => r.display_title !== OWNER_EMAIL_TEST_RUN_NAME);
  const previousRun = history.workflow_runs?.find(r => String(r.id) !== env.GITHUB_RUN_ID);
  let previous;
  if (previousRun) {
    const previousJobs = await get(`${api}/actions/runs/${previousRun.id}/jobs?per_page=100`);
    const checks = previousJobs.jobs?.filter(j => ['readiness', 'backup'].includes(j.name)) || [];
    if (checks.length === 2) previous = { conclusion: checks.every(j => j.conclusion === SUCCESS) ? SUCCESS : 'failure' };
  }
  const kind = notificationKind(current, previous, env.ALERT_TEST === 'true');
  if (!kind) return { status: 'HEALTHY_NO_NOTIFICATION' };
  if (kind === 'FAILURE' && previous?.conclusion === 'failure') {
    for (const prior of (history.workflow_runs || []).filter(r => String(r.id) !== env.GITHUB_RUN_ID && Date.now() - Date.parse(r.created_at) < 30 * 60000)) {
      const jobs = await get(`${api}/actions/runs/${prior.id}/jobs?per_page=100`);
      // A completed sender, even with partial channel failure, consumes the cooldown.
      if (jobs.jobs?.some(j => j.name === 'alerts' && j.status === 'completed' && j.conclusion !== 'skipped')) return { status: 'SUPPRESSED', cooldownMinutes: 30 };
    }
  }
  // Only fixed check names and allowlisted evidence are rendered, never raw logs.
  const enriched = { ...env };
  try {
    const jobs = await get(`${api}/actions/runs/${env.GITHUB_RUN_ID}/jobs?per_page=100`);
    for (const name of ['readiness', 'backup']) {
      const job = jobs.jobs?.find(j => j.name === name);
      if (!job) continue;
      if (name === 'readiness') enriched.READINESS_STEPS = job.steps;
      if (!/^\d+$/.test(String(job.id))) continue;
      try {
        const response = await fetcher(`${api}/actions/jobs/${job.id}/logs`, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        if (response.ok) enriched[name === 'backup' ? 'BACKUP_LOG' : 'READINESS_LOG'] = (await response.text()).slice(0, 200000);
      } catch { /* Step metadata still identifies the check when logs are unavailable. */ }
    }
  } catch { /* Keep honest unknown details when GitHub evidence is unavailable. */ }
  return { status: 'ATTEMPTED', kind, severity: alertDetails(enriched, kind).severity, results: await deliverAlert(enriched, kind, fetcher) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const configuration = await prepareAlertEnvironment(process.env);
    const report = { verifiedAt: new Date().toISOString(), recipientSource: configuration.source, ...(configuration.source === 'OWNER_EMAIL_TEST' ? { testRecipient: configuration.env.ALERT_EMAIL_TO } : {}), ...(await run(configuration.env)) };
    await writeFile('production-alert-result.json', JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report));
    if (report.results?.some(r => !r.accepted)) process.exitCode = 1;
  } catch {
    console.error('Alert dispatch failed; inspect monitor history/configuration. No automatic message replay.'); process.exitCode = 1;
  }
}
