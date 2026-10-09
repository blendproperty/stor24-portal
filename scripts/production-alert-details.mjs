// Only allowlisted aggregate evidence reaches recipients; never forward raw job logs.
export function backupEvidence(log = '') {
  if (/ssh: connect to host .*Connection timed out/.test(log)) return { severity: 'WARNING', failure: 'Monitoring connection timed out', details: 'SSH connection exceeded 20 seconds; backup and resource checks could not run.', impact: 'Backup and resource health unverified; no backup failure established.' };
  if (/HOST_DISK_THRESHOLD/.test(log)) return { severity: 'HIGH', failure: 'Server disk threshold exceeded', details: 'Root disk usage is at least 85%.', impact: 'Low disk headroom may interrupt writes and backups.' };
  if (/HOST_MEMORY_THRESHOLD/.test(log)) return { severity: 'HIGH', failure: 'Server memory threshold exceeded', details: 'Available memory is 10% or less.', impact: 'Application stability may be affected.' };
  if (/DATABASE_CONNECTION_THRESHOLD/.test(log)) return { severity: 'HIGH', failure: 'Database connection threshold exceeded', details: 'Database connections are at least 80% of capacity.', impact: 'New database requests may be affected.' };
  const resources = log.match(/Host disk (\d+)%\s*; available memory (\d+)%\s*; database connections (\d+)\/(\d+); app healthy, no OOM/);
  if (/Encrypted backup freshness verified/.test(log) && resources) return { severity: 'INFO', failure: 'None detected', details: `Encrypted backup verified within 26 hours; disk ${resources[1]}%; available memory ${resources[2]}%; database connections ${resources[3]}/${resources[4]}; application healthy, no out-of-memory kill.`, impact: 'Current backup and resource checks passed.' };
  return null;
}

export function alertDetails(env, kind, now = new Date()) {
  let evidence;
  try { evidence = backupEvidence(env.BACKUP_LOG || ''); } catch {}
  const readinessFailed = env.READINESS_RESULT !== 'success';
  const backupFailed = env.BACKUP_RESULT !== 'success';
  const severity = kind === 'TEST' || kind === 'RECOVERY' ? 'INFO' : readinessFailed ? 'HIGH' : backupFailed ? (evidence?.severity === 'INFO' ? 'WARNING' : evidence?.severity || 'WARNING') : 'INFO';
  const failure = kind === 'TEST' ? 'Delivery test' : readinessFailed ? 'Application readiness or origin protection check failed' : backupFailed ? evidence?.failure || 'Backup/resource check incomplete or failed' : 'None detected';
  const details = kind === 'TEST' ? 'Notification delivery test; inspect check results separately.' : readinessFailed ? 'Application/database readiness or origin protection failed; inspect the failed step.' : evidence?.details || `Application ${env.READINESS_RESULT}; backup/resources ${env.BACKUP_RESULT}; specific cause unavailable.`;
  const impact = kind === 'TEST' ? 'This test does not establish service health.' : readinessFailed ? 'Application availability or origin protection requires investigation.' : evidence?.impact || (backupFailed ? 'Backup/resource health requires investigation; failure is not yet classified.' : 'Current checks passed.');
  const time = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(now) + ' SAST';
  // Suggested response targets, not a contractual SLA or a guarantee of safe delay.
  const priority = kind === 'TEST' ? 'Routine' : kind === 'RECOVERY' ? 'Follow-up' : severity === 'HIGH' ? 'Urgent' : 'Prompt';
  const timeframe = kind === 'TEST' ? 'Next business day' : kind === 'RECOVERY' ? 'Next business day, if checks remain healthy' : severity === 'HIGH' ? 'Immediately - begin investigation now' : 'Within 2 hours - do not defer an unresolved failure overnight';
  const connectionFailure = backupFailed && evidence?.failure === 'Monitoring connection timed out';
  const remedy = kind === 'TEST' ? 'Confirm receipt of this labelled test.' : kind === 'RECOVERY' ? 'Review the earlier failure and subsequent healthy checks; investigate recurrence.' : connectionFailure && !readinessFailed ? 'Confirm application health; retry the read-only monitor check; investigate SSH/network access if it fails again.' : 'Inspect the failed monitor step and verify current application, backup and resource health before choosing a fix.';
  const escalation = kind === 'TEST' ? 'Use actual failed check results to determine operational urgency.' : kind === 'RECOVERY' ? 'If a check fails again, use the active failure response target.' : severity === 'HIGH' ? 'Escalate immediately to the technical owner; keep investigating until health is verified.' : 'Escalate sooner if application health fails; escalate to the technical owner if a fresh check still fails or health cannot be verified within 2 hours.';
  const action = kind === 'RECOVERY' ? 'Recovered at this observation; elapsed time between checks is not outage duration.' : remedy;
  const rows = [['Time', time], ['Status', kind], ['Failure', failure], ['Details', details], ['Severity', severity], ['Impact', impact], ['Response priority', priority], ['Action timeframe (suggested)', timeframe], ['Suggested remedy', remedy], ['Escalation', escalation], ['Action', action]];
  if (/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '') && /^\d+$/.test(env.GITHUB_RUN_ID || '')) rows.push(['Monitor', `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`]);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return { severity, priority, timeframe, time, rows, text: `STOR24 operations notification\n${rows.map(([k,v]) => `${k}: ${v}`).join('\n')}`, html: `<h2>STOR24 operations notification</h2><table style="border-collapse:collapse;font-family:Arial,sans-serif">${rows.map(([k,v]) => `<tr><th style="text-align:left;padding:10px;border:1px solid #ddd">${escape(k)}</th><td style="padding:10px;border:1px solid #ddd">${escape(v)}</td></tr>`).join('')}</table>`, summary: `Severity: ${severity}; Failure: ${failure}; Details: ${details}; Impact: ${impact}; Response priority: ${priority}; Suggested timeframe: ${timeframe}; Remedy: ${remedy}; Escalation: ${escalation}` };
}
