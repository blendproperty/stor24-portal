import { readFile } from 'node:fs/promises';
import { safeMonitorEntry } from '../src/lib/operations-status-policy.mjs';
import { monitorRequest } from './host-heartbeat-policy.mjs';
try {
  const report = JSON.parse(await readFile('production-alert-result.json', 'utf8'));
  const entry = safeMonitorEntry({ ...report, checkedAt: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID, readiness: process.env.READINESS_RESULT, backup: process.env.BACKUP_RESULT });
  if (!entry) throw new Error('INVALID_MONITOR_REPORT');
  await monitorRequest(process.env, 'dashboard', { method: 'POST', body: entry });
  console.log('Aggregate monitoring evidence published over HTTPS.');
} catch { console.error('STOR24_DASHBOARD_PUBLICATION_FAILED'); process.exitCode = 1; }
