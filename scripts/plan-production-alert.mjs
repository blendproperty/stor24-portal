import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadAlertRecipients } from './load-alert-recipients.mjs';

const SUCCESS = 'success';
export function notificationKind(current, previous, test = false) {
  if (test) return 'TEST';
  if (current.readiness !== SUCCESS || current.backup !== SUCCESS) return 'FAILURE';
  if (previous && previous.conclusion !== SUCCESS) return 'RECOVERY';
  return null;
}

export async function planNotification(env, fetcher = fetch) {
  if (Number(env.GITHUB_RUN_ATTEMPT || '1') > 1) return { status: 'SKIPPED_REPLAY', reason: 'Use a fresh explicit test run; provider requests are not replayed.' };
  const current = { readiness: env.READINESS_RESULT, backup: env.BACKUP_RESULT };
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
  const api = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  const get = async url => { const r = await fetcher(url, { headers, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('Monitor history unavailable'); return r.json(); };
  const history = await get(`${api}/actions/workflows/monitor-production.yml/runs?status=completed&per_page=10`);
  if (!Array.isArray(history.workflow_runs)) throw new Error('Monitor history unavailable');
  const previousRun = history.workflow_runs.find(r => String(r.id) !== env.GITHUB_RUN_ID);
  let previous;
  if (previousRun) {
    const previousJobs = await get(`${api}/actions/runs/${previousRun.id}/jobs?per_page=100`);
    if (!Array.isArray(previousJobs.jobs)) throw new Error('Monitor job history unavailable');
    const checks = previousJobs.jobs.filter(j => ['readiness', 'backup'].includes(j.name)) || [];
    if (checks.length !== 2 || new Set(checks.map(j => j.name)).size !== 2) throw new Error('Monitor check history incomplete');
    previous = { conclusion: checks.every(j => j.conclusion === SUCCESS) ? SUCCESS : 'failure' };
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
  return { status: 'DELIVERY_REQUIRED', kind };
}

export async function preflight(env, fetcher = fetch) {
  try { return await planNotification(env, fetcher); }
  catch { return { status: 'DELIVERY_REQUIRED', reason: 'HISTORY_UNAVAILABLE' }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = await preflight(process.env);
  const notify = plan.status === 'DELIVERY_REQUIRED';
  if (!notify) {
    // Keep the encrypted fallback current even during a long healthy period. No provider sends.
    const configuration = await loadAlertRecipients(process.env);
    writeFileSync('production-alert-result.json', JSON.stringify({ verifiedAt: new Date().toISOString(), recipientSource: configuration.source, ...plan }, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `notify=${notify}\n`);
  console.log(JSON.stringify(plan));
}
