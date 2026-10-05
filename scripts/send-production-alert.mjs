import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateAlertRecipients } from '../src/lib/operations-alert-policy.mjs';
import { loadAlertRecipients } from './load-alert-recipients.mjs';

const SUCCESS = 'success';
export function notificationKind(current, previous, test = false) {
  if (test) return 'TEST';
  if (current.readiness !== SUCCESS || current.backup !== SUCCESS) return 'FAILURE';
  if (previous && previous.conclusion !== SUCCESS) return 'RECOVERY';
  return null;
}

export async function deliverAlert(env, kind, fetcher = fetch) {
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
  const text = `STOR24 ${kind} ALERT. Application: ${env.READINESS_RESULT}. Backup/resources: ${env.BACKUP_RESULT}. ${kind === 'TEST' ? 'Delivery test only; no outage detected. ' : ''}Review the production monitor in GitHub.`;
  const request = async (channel, url, options) => {
    try {
      const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (channel === 'EMAIL') return { channel, accepted: response.status === 202, httpStatus: response.status };
      const data = await response.json();
      return { channel, accepted: response.ok, httpStatus: response.status, status: data.status, code: data.code, reference: response.ok ? data.sid : undefined };
    } catch {
      // An uncertain provider result must never be automatically replayed.
      return { channel, accepted: false, status: 'UNCERTAIN', automaticRetry: false };
    }
  };
  const emails = (env.ALERT_EMAIL_TO || '').split(',').map(x => x.trim()).filter(Boolean);
  if (allowed.includes('EMAIL')) {
  if (!emails.length || !env.SENDGRID_API_KEY || !env.EMAIL_FROM) results.push({ channel: 'EMAIL', accepted: false, status: 'CONFIG_REQUIRED' });
  else {
    const match = env.EMAIL_FROM.match(/^(.*)<([^<>]+)>$/);
    const from = match ? { email: match[2].trim(), name: match[1].trim().replace(/^"|"$/g, '') } : { email: env.EMAIL_FROM.trim() };
    for (const email of emails) results.push(await request('EMAIL', 'https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalizations: [{ to: [{ email }] }], from, subject: `STOR24 ${kind} ALERT`, content: [{ type: 'text/plain', value: text }] }),
    }));
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
        ContentVariables: JSON.stringify({ '1': kind, '2': `Application ${env.READINESS_RESULT}; backup/resources ${env.BACKUP_RESULT}`, '3': new Date().toISOString() }) };
    }
    results.push(await request(channel, `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
    }));
  }
  return results;
}

export async function run(env, fetcher = fetch) {
  if (Number(env.GITHUB_RUN_ATTEMPT || '1') > 1) return { status: 'SKIPPED_REPLAY', reason: 'Use a fresh explicit test run; provider requests are not replayed.' };
  const current = { readiness: env.READINESS_RESULT, backup: env.BACKUP_RESULT };
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
  const api = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  const get = async url => { const r = await fetcher(url, { headers, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('Monitor history unavailable'); return r.json(); };
  const history = await get(`${api}/actions/workflows/monitor-production.yml/runs?status=completed&per_page=10`);
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
  return { status: 'ATTEMPTED', kind, results: await deliverAlert(env, kind, fetcher) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const configuration = await loadAlertRecipients(process.env);
    const env = configuration.recipients ? { ...process.env, ALERT_RECIPIENTS_JSON: JSON.stringify(configuration.recipients) } : process.env;
    const report = { verifiedAt: new Date().toISOString(), recipientSource: configuration.source, ...(await run(env)) };
    await writeFile('production-alert-result.json', JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report));
    if (report.results?.some(r => !r.accepted)) process.exitCode = 1;
  } catch {
    console.error('Alert dispatch failed; inspect monitor history/configuration. No automatic message replay.'); process.exitCode = 1;
  }
}
