// Only allowlisted aggregate evidence reaches recipients; never forward raw job logs.
export function backupEvidence(log = '') {
  if (/ssh: connect to host .*Connection timed out/.test(log)) return { severity: 'WARNING', failure: 'Monitoring connection timed out', details: 'SSH connection attempts were exhausted; backup and resource checks could not run.', impact: 'Backup and resource health unverified; no backup failure established.' };
  if (/Permission denied|Host key verification failed/.test(log)) return { severity: 'WARNING', failure: 'Monitoring SSH authentication or host verification failed', details: 'The monitor could not authenticate or verify the SSH server; backup and resource checks could not run.', impact: 'Backup/resource health is unverified; no backup failure established.' };
  if (/HOST_DISK_THRESHOLD/.test(log)) return { severity: 'HIGH', failure: 'Server disk threshold exceeded', details: 'Root disk usage is at least 85%.', impact: 'Low disk headroom may interrupt writes and backups.' };
  if (/HOST_MEMORY_THRESHOLD/.test(log)) return { severity: 'HIGH', failure: 'Server memory threshold exceeded', details: 'Available memory is 10% or less.', impact: 'Application stability may be affected.' };
  if (/DATABASE_CONNECTION_THRESHOLD/.test(log)) return { severity: 'HIGH', failure: 'Database connection threshold exceeded', details: 'Database connections are at least 80% of capacity.', impact: 'New database requests may be affected.' };
  if (/(?:^|\n)(?:\d{4}-[^ ]+ )?STOR24_RESOURCES_FAILED\r?(?:\n|$)/.test(log)) return { severity: 'HIGH', failure: 'Server resource or container health check failed', details: 'The encrypted backup check passed, then the server resource/container check failed.', impact: 'Server resources or application container health requires investigation.' };
  if (/(?:^|\n)(?:\d{4}-[^ ]+ )?STOR24_BACKUP_FAILED\r?(?:\n|$)/.test(log)) return { severity: 'HIGH', failure: 'Encrypted backup verification failed', details: 'The remote backup freshness/integrity check failed; resource checks did not run.', impact: 'A current verified encrypted backup could not be established.' };
  const resources = log.match(/Host disk (\d+)%\s*; available memory (\d+)%\s*; database connections (\d+)\/(\d+); app healthy, no OOM/);
  if (/Encrypted backup freshness verified/.test(log) && resources) return { severity: 'INFO', failure: 'None detected', details: `Encrypted backup verified within 26 hours; disk ${resources[1]}%; available memory ${resources[2]}%; database connections ${resources[3]}/${resources[4]}; application healthy, no out-of-memory kill.`, impact: 'Current backup and resource checks passed.' };
  return null;
}

export function readinessEvidence(log = '', steps = []) {
  const publicChecks = [...log.matchAll(/(?:^|\n)(?:\d{4}-[^ ]+ )?STOR24_PUBLIC_FAILED check=(json|service|application|database|expiry-worker)\r?(?=\n|$)/g)].map(m => m[1]);
  if (publicChecks.length) return { severity: 'HIGH', failure: `Public readiness validation failed: ${[...new Set(publicChecks)].join(', ')}`, details: 'The health endpoint responded but the named validation(s) failed; origin verification did not run.', impact: 'Public application readiness failed validation.' };
  if (/(?:^|\n)(?:\d{4}-[^ ]+ )?STOR24_PUBLIC_UNAVAILABLE\r?(?:\n|$)/.test(log)) return { severity: 'HIGH', failure: 'Public health endpoint unavailable', details: 'The public health HTTP request failed after bounded retries; origin verification did not run.', impact: 'Public application readiness could not be established.' };
  const origin = log.match(/STOR24_ORIGIN_(FAILED|UNVERIFIED) host=(stor24\.co\.za|www\.stor24\.co\.za|portal\.stor24\.co\.za|cms\.stor24\.co\.za) probe=(plain|forged) (?:http=(\d{3})|curl=(\d{1,3}) attempts=([123]))(?:\s|$)/);
  if (origin) return origin[1] === 'FAILED'
    ? { severity: 'HIGH', failure: 'Direct-origin access returned an unexpected HTTP response', details: `${origin[2]} (${origin[3]}): HTTP ${origin[4]}; expected 403 access denied.`, impact: 'Origin access protection requires immediate investigation; inspect the unexpected response.' }
    : { severity: 'WARNING', failure: 'Origin protection check unavailable', details: `${origin[2]} (${origin[3]}): connection/transport failed (curl ${origin[5]}) after ${origin[6]} attempt(s).`, impact: 'Direct-origin protection is unverified; no successful bypass was observed.' };
  const failed = Array.isArray(steps) ? steps.find(s => s.conclusion === 'failure' || s.conclusion === 'timed_out') : null;
  if (failed?.name === 'Verify public application and database readiness') return { severity: 'HIGH', failure: 'Public application/database readiness check failed', details: 'The public health request or application/database/expiry-worker validation failed; origin verification did not run.', impact: 'Public application readiness could not be established.' };
  if (failed?.name === 'Verify Cloudflare origin protection cannot be bypassed directly') return { severity: 'WARNING', failure: 'Origin protection check unavailable', details: 'Public application/database readiness passed; the direct-origin check failed. Specific cause unavailable.', impact: 'Direct-origin protection is unverified; no successful bypass was established.' };
  return { severity: 'HIGH', failure: 'Readiness job incomplete or failed', details: 'Readiness job failed or did not complete; specific failed-step evidence unavailable.', impact: 'Application readiness and origin protection require verification.' };
}

export function alertDetails(env, kind, now = new Date()) {
  const readinessFailed = env.READINESS_RESULT !== 'success';
  const backupFailed = env.BACKUP_RESULT !== 'success';
  const backup = backupEvidence(env.BACKUP_LOG || '');
  const findings = [];
  if (readinessFailed) findings.push(readinessEvidence(env.READINESS_LOG || '', env.READINESS_STEPS));
  if (backupFailed) findings.push(backup?.severity !== 'INFO' && backup || { severity: 'WARNING', failure: 'Backup/resource check incomplete or failed', details: 'Backup/resource job did not pass; specific cause unavailable.', impact: 'Backup/resource health is unverified.' });
  const informational = kind === 'TEST' || kind === 'RECOVERY';
  const severity = informational ? 'INFO' : findings.some(f => f.severity === 'HIGH') ? 'HIGH' : findings.length ? 'WARNING' : 'INFO';
  const failure = kind === 'TEST' ? 'Delivery test' : findings.length ? findings.map(f => f.failure).join('; ') : 'None detected';
  const details = kind === 'TEST' ? 'Notification delivery test; inspect check results separately.' : findings.length ? findings.map(f => f.details).join(' ') : backup?.details || 'Public readiness, origin protection and backup/resource checks passed.';
  const impact = kind === 'TEST' ? 'This test does not establish service health.' : findings.length ? findings.map(f => f.impact).join(' ') : backup?.impact || 'Current checks passed.';
  const time = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(now) + ' SAST';
  // Suggested response targets, not a contractual SLA or a guarantee of safe delay.
  const priority = kind === 'TEST' ? 'Routine' : kind === 'RECOVERY' ? 'Follow-up' : severity === 'HIGH' ? 'Urgent' : 'Prompt';
  const timeframe = kind === 'TEST' ? 'Next business day' : kind === 'RECOVERY' ? 'Next business day, if checks remain healthy' : severity === 'HIGH' ? 'Immediately - begin investigation now' : 'Within 2 hours - do not defer an unresolved failure overnight';
  const connectionFailure = findings.some(f => f.failure === 'Monitoring connection timed out');
  const remedy = kind === 'TEST' ? 'Confirm receipt of this labelled test.' : kind === 'RECOVERY' ? 'Review the earlier failure and subsequent healthy checks; investigate recurrence.' : connectionFailure && !readinessFailed ? 'Confirm application health; retry the read-only monitor check; investigate SSH/network access if it fails again.' : 'Inspect the failed monitor step and verify current application, backup and resource health before choosing a fix.';
  const escalation = kind === 'TEST' ? 'Use actual failed check results to determine operational urgency.' : kind === 'RECOVERY' ? 'If a check fails again, use the active failure response target.' : severity === 'HIGH' ? 'Escalate immediately to the technical owner; keep investigating until health is verified.' : 'Escalate sooner if application health fails; escalate to the technical owner if a fresh check still fails or health cannot be verified within 2 hours.';
  const action = kind === 'RECOVERY' ? 'Recovered at this observation; elapsed time between checks is not outage duration.' : remedy;
  const rows = [['Time', time], ['Status', kind], ['Failure', failure], ['Details', details], ['Severity', severity], ['Impact', impact], ['Response priority', priority], ['Action timeframe (suggested)', timeframe], ['Suggested remedy', remedy], ['Escalation', escalation], ['Action', action]];
  rows.push(['Checks', `Public readiness/origin: ${env.READINESS_RESULT}; backup/resources: ${env.BACKUP_RESULT}`]);
  if (/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '') && /^\d+$/.test(env.GITHUB_RUN_ID || '')) rows.push(['Monitor', `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`]);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return { severity, priority, timeframe, time, rows, text: `STOR24 operations notification\n${rows.map(([k,v]) => `${k}: ${v}`).join('\n')}`, html: `<h2>STOR24 operations notification</h2><table style="border-collapse:collapse;font-family:Arial,sans-serif">${rows.map(([k,v]) => `<tr><th style="text-align:left;padding:10px;border:1px solid #ddd">${escape(k)}</th><td style="padding:10px;border:1px solid #ddd">${escape(v)}</td></tr>`).join('')}</table>`, summary: `Severity: ${severity}; Failure: ${failure}; Details: ${details}; Impact: ${impact}; Response priority: ${priority}; Suggested timeframe: ${timeframe}; Remedy: ${remedy}; Escalation: ${escalation}` };
}
