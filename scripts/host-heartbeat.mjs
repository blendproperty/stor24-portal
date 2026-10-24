import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { safeHeartbeat, monitorRequest } from './host-heartbeat-policy.mjs';
import { safeMonitorEntry } from '../src/lib/operations-status-policy.mjs';
import { saveMonitor } from './write-monitor-status.mjs';

export function collectHostHeartbeat(run = spawnSync) {
  const result = { version: 1, checkedAt: new Date().toISOString(), backup: 'unknown', resources: 'unknown', markers: [] };
  for (const [check, script, failure] of [['backup', 'dlp-backup-health.sh', 'STOR24_BACKUP_FAILED'], ['resources', 'production-resource-health.sh', 'STOR24_RESOURCES_FAILED']]) {
    const probe = run('/bin/bash', [`/opt/stor24-crm/scripts/${script}`], { encoding: 'utf8', timeout: 25_000, maxBuffer: 8192 });
    result[check] = probe.error || probe.status == null ? 'unknown' : probe.status === 0 ? 'success' : 'failure';
    if (result[check] === 'unknown') result.markers.push('STOR24_HOST_CHECK_UNAVAILABLE');
    if (result[check] === 'failure') {
      result.markers.push(failure);
      for (const marker of ['HOST_DISK_THRESHOLD', 'HOST_MEMORY_THRESHOLD', 'DATABASE_CONNECTION_THRESHOLD']) if (String(probe.stdout).split(/\r?\n/).includes(marker)) result.markers.push(marker);
    }
  }
  result.checkedAt = new Date().toISOString();
  return safeHeartbeat(result);
}
export async function publishHostHeartbeat(env, { run, fetcher, save = saveMonitor } = {}) {
  const report = collectHostHeartbeat(run);
  await monitorRequest(env, 'host', { method: 'POST', body: report, fetcher });
  console.info('STOR24_HOST_HEARTBEAT_PUBLISHED');
  // Dashboard publication also travels outbound: never require an inbound SSH session.
  const monitor = await monitorRequest(env, 'dashboard', { fetcher });
  if (monitor.entry) {
    const entry = safeMonitorEntry(monitor.entry);
    if (!entry) throw new Error('INVALID_MONITOR_REPORT');
    await save(entry);
    console.info('STOR24_DASHBOARD_EVIDENCE_SYNCED');
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await publishHostHeartbeat(process.env);
  } catch { console.error('STOR24_HOST_HEARTBEAT_PUBLISH_FAILED'); process.exitCode = 1; }
}
