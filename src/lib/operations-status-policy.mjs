const states = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'unknown']);
const sources = new Set(['SAVED_RECIPIENTS', 'SAVED_RECIPIENTS_NO_CACHE', 'ENCRYPTED_LAST_KNOWN', 'EMERGENCY_DEFAULTS']);
const dispatch = new Set(['ATTEMPTED', 'HEALTHY_NO_NOTIFICATION', 'SUPPRESSED', 'SKIPPED_REPLAY', 'UNAVAILABLE']);
export function recent(timestamp, maxAge, now = Date.now()) {
  const age = typeof timestamp === 'string' ? now - Date.parse(timestamp) : NaN;
  return Number.isFinite(age) && age >= -60_000 && age <= maxAge;
}
export function safeHostStatus(value) {
  if (!value || typeof value !== 'object' || !recent(value.checkedAt, 24 * 3600_000)) return null;
  const number = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  return { checkedAt: value.checkedAt, diskUsedPercent: number(value.diskUsedPercent, 100), memoryAvailablePercent: number(value.memoryAvailablePercent, 100),
    databaseConnections: number(value.databaseConnections, 1_000_000), databaseLimit: number(value.databaseLimit, 1_000_000),
    appHealth: ['healthy', 'unhealthy', 'starting'].includes(value.appHealth) ? value.appHealth : 'unknown',
    oomKilled: typeof value.oomKilled === 'boolean' ? value.oomKilled : null,
    image: typeof value.image === 'string' && /^stor24-crm:[a-f0-9]{7,40}$/.test(value.image) ? value.image : null };
}
export function safeMonitorEntry(value) {
  if (!value || typeof value !== 'object' || !/^\d{1,20}$/.test(String(value.runId)) || !recent(value.checkedAt, 30 * 24 * 3600_000)) return null;
  return { runId: String(value.runId), checkedAt: value.checkedAt,
    readiness: states.has(value.readiness) ? value.readiness : 'unknown', backup: states.has(value.backup) ? value.backup : 'unknown',
    recipientSource: sources.has(value.recipientSource) ? value.recipientSource : null,
    status: dispatch.has(value.status) ? value.status : 'UNAVAILABLE', kind: ['TEST', 'FAILURE', 'RECOVERY'].includes(value.kind) ? value.kind : null,
    channels: ['EMAIL', 'SMS', 'WHATSAPP'].map(channel => {
      const results = Array.isArray(value.results) ? value.results.filter(r => r?.channel === channel).slice(0, 20) : [];
      // Already sanitised records are accepted only with bounded aggregate counts.
      const previous = Array.isArray(value.channels) ? value.channels.find(r => r?.channel === channel) : null;
      const valid = previous && Number.isInteger(previous.accepted) && previous.accepted >= 0 && previous.accepted <= 20 && Number.isInteger(previous.failed) && previous.failed >= 0 && previous.failed <= 20;
      return { channel, accepted: valid ? previous.accepted : results.filter(r => r.accepted === true).length, failed: valid ? previous.failed : results.filter(r => r.accepted !== true).length };
    }) };
}
export function safeMonitorHistory(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const row of value.slice(0, 50)) { const entry = safeMonitorEntry(row); if (entry && !unique.has(entry.runId)) unique.set(entry.runId, entry); }
  return [...unique.values()].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt)).slice(0, 20);
}
