import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateAlertRecipients } from '../src/lib/operations-alert-policy.mjs';
import { loadAlertRecipients } from './load-alert-recipients.mjs';
import { HOSTINGER_EMAIL_ADDRESS, hostingerTransport } from '../src/lib/hostinger-transport.mjs';
import { alertDetails } from './production-alert-details.mjs';

const stages = new Set(['RUNS', 'JOBS']);
const historyCodes = new Set(['TRANSPORT', 'HTTP', 'INVALID_JSON']);
export class MonitorHistoryError extends Error {
  constructor(stage, code, attempts, httpStatus) {
    super('Monitor history unavailable');
    this.stage = stages.has(stage) ? `HISTORY_${stage}` : 'HISTORY';
    this.code = historyCodes.has(code) ? code : 'UNEXPECTED';
    this.attempts = attempts === 1 || attempts === 2 ? attempts : 0;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
  }
}

// Only read-only GitHub history requests enter this function. Notification sends never do.
export async function readMonitorHistory(url, headers, fetcher = fetch, { stage = 'RUNS', wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try { response = await fetcher(url, { method: 'GET', headers, signal: AbortSignal.timeout(15_000) }); }
    catch {
      if (attempt === 2) throw new MonitorHistoryError(stage, 'TRANSPORT', attempt);
      await wait(500); continue;
    }
    if (!response.ok) {
      const status = response.status;
      if (attempt < 2 && (status === 429 || status >= 500)) { await response.body?.cancel().catch(() => {}); await wait(500); continue; }
      throw new MonitorHistoryError(stage, 'HTTP', attempt, status);
    }
    try { return await response.json(); }
    catch (error) {
      if (error instanceof SyntaxError) throw new MonitorHistoryError(stage, 'INVALID_JSON', attempt);
      if (attempt === 2) throw new MonitorHistoryError(stage, 'TRANSPORT', attempt);
      await wait(500);
    }
  }
}

export function safeAlertFailure(error, stage) {
  return error instanceof MonitorHistoryError ? { stage: error.stage, code: error.code, attempts: error.attempts, ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }) }
    : { stage: ['RECIPIENTS', 'DISPATCH', 'REPORT'].includes(stage) ? stage : 'DISPATCH', code: 'UNEXPECTED' };
}

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
  const current = { readiness: env.READINESS_RESULT, backup: env.BACKUP_RESULT };
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
  const api = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  const get = url => readMonitorHistory(url, headers, fetcher, { stage: url.includes('/workflows/') ? 'RUNS' : 'JOBS' });
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

export async function executeProductionAlert(env, { fetcher = fetch, recipientLoader = loadAlertRecipients,
  writeReport = report => writeFile('production-alert-result.json', JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 }) } = {}) {
  let stage = 'RECIPIENTS', configuration, report;
  try {
    configuration = await recipientLoader(env, fetcher);
    const configured = configuration.recipients ? { ...env, ALERT_RECIPIENTS_JSON: JSON.stringify(configuration.recipients) } : env;
    stage = 'DISPATCH';
    report = { verifiedAt: new Date().toISOString(), recipientSource: configuration.source, ...(await run(configured, fetcher)) };
    stage = 'REPORT';
    await writeReport(report);
    return { report, persisted: true, exitCode: report.results?.some(result => !result.accepted) ? 1 : 0 };
  } catch (error) {
    const failure = { verifiedAt: new Date().toISOString(), recipientSource: configuration?.source || null, status: 'UNAVAILABLE',
      diagnostic: safeAlertFailure(error, stage), automaticReplay: false,
      deliveryState: error instanceof MonitorHistoryError || stage === 'RECIPIENTS' ? 'NOT_ATTEMPTED' : 'MAY_HAVE_OCCURRED' };
    // Preserve observable failure evidence. Never retry the sender/provider path here.
    try { await writeReport(failure); return { report: failure, persisted: true, exitCode: 1 }; }
    catch { return { report: failure, persisted: false, exitCode: 1 }; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await executeProductionAlert(process.env);
  console.log(JSON.stringify(result.report));
  if (!result.persisted) console.error('STOR24_ALERT_RESULT_WRITE_FAILED');
  if (result.exitCode) process.exitCode = result.exitCode;
}
