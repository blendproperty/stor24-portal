// Only fixed operational findings cross the host/monitor boundary.
export const HEARTBEAT_URL = 'https://portal.stor24.co.za/_operations/monitor';
export const HOST_MAX_AGE = 15 * 60_000;
const states = new Set(['success', 'failure', 'unknown']);
const markers = new Set(['STOR24_BACKUP_FAILED', 'STOR24_RESOURCES_FAILED', 'HOST_DISK_THRESHOLD', 'HOST_MEMORY_THRESHOLD', 'DATABASE_CONNECTION_THRESHOLD', 'STOR24_HOST_CHECK_UNAVAILABLE']);
export function safeHeartbeat(value) {
  if (value?.version !== 1 || !Number.isFinite(Date.parse(value.checkedAt)) || !states.has(value.backup) || !states.has(value.resources) || !Array.isArray(value.markers) || value.markers.length > 6 || value.markers.some(x => !markers.has(x))) return null;
  // A claimed success must not hide a failed check, and failures need concrete markers.
  const backupFailed = value.markers.includes('STOR24_BACKUP_FAILED');
  const resourcesFailed = value.markers.some(x => ['STOR24_RESOURCES_FAILED', 'HOST_DISK_THRESHOLD', 'HOST_MEMORY_THRESHOLD', 'DATABASE_CONNECTION_THRESHOLD'].includes(x));
  if ((value.backup === 'failure') !== backupFailed || (value.resources === 'failure') !== resourcesFailed || (value.backup === 'unknown' || value.resources === 'unknown') !== value.markers.includes('STOR24_HOST_CHECK_UNAVAILABLE')) return null;
  return { version: 1, checkedAt: value.checkedAt, backup: value.backup, resources: value.resources, markers: [...new Set(value.markers)] };
}
export function freshHeartbeat(record, now = Date.now()) {
  const report = safeHeartbeat(record?.report);
  const age = timestamp => now - Date.parse(timestamp);
  if (!report || !Number.isFinite(age(record.receivedAt)) || age(record.receivedAt) < -60_000 || age(record.receivedAt) > HOST_MAX_AGE || age(report.checkedAt) < -60_000 || age(report.checkedAt) > HOST_MAX_AGE) return null;
  return report;
}
export async function monitorRequest(env, suffix, { method = 'GET', body, fetcher = fetch } = {}) {
  const key = env.STOR24_HEARTBEAT_KEY;
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('MONITOR_AUTH_CONFIGURATION');
  let response;
  // Only these idempotent evidence reads/writes retry; provider notification sends never do.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetcher(`${HEARTBEAT_URL}/${suffix}`, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'STOR24-independent-monitor' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status < 500 && response.status !== 429) break;
    } catch { if (attempt === 1) throw new Error('MONITOR_REPORT_TRANSPORT'); }
  }
  if (!response) throw new Error('MONITOR_REPORT_TRANSPORT');
  if (!response.ok) throw new Error('MONITOR_REPORT_TRANSPORT');
  const text = await response.text();
  if (text.length > 24_000) throw new Error('MONITOR_REPORT_TOO_LARGE');
  return JSON.parse(text);
}
