import { open } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { dlpBackupStatus } from '@/lib/dlp-backup-status';
import { readOperationsAlerts } from '@/lib/operations-alerts';
import { configuredMessagingChannels } from '@/lib/integrations/messaging-readiness';
import { recent, safeHostStatus, safeMonitorHistory } from './operations-status-policy.mjs';

export type DiagnosticCard = { id: string; title: string; state: 'good' | 'warning' | 'critical' | 'unknown'; value: string; detail: string; next: string; checkedAt: string | null; href?: string };
const knownProviders: Record<string, string> = { HIKCENTRAL: 'HikCentral', NETCASH: 'Netcash', MRI: 'MRI accounting', BLENDSIGN: 'BlendSign', TWILIO: 'Twilio', SENDGRID: 'SendGrid' };
async function statusFile(name: 'operations.json' | 'monitor.json') {
  if (!process.env.DLP_BACKUP_STATUS_PATH) return null;
  let file;
  try { file = await open(path.join(process.env.DLP_BACKUP_STATUS_PATH, name), 'r'); const buffer = Buffer.alloc(64_001); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); if (bytesRead > 64_000) return null; return JSON.parse(buffer.subarray(0, bytesRead).toString()); }
  catch { return null; } finally { await file?.close(); }
}
export async function operationsDiagnostics(organisationId: string) {
  const checkedAt = new Date().toISOString();
  const result = await Promise.allSettled([
    db.$queryRaw`SELECT 1`, dlpBackupStatus(), statusFile('operations.json'), statusFile('monitor.json'),
    db.integrationConnection.findMany({ where: { organisationId }, select: { provider: true, status: true, lastHealthAt: true }, take: 30, orderBy: { updatedAt: 'desc' } }),
    db.webhookInbox.groupBy({ by: ['status'], where: { organisationId }, _count: true }),
    db.webhookOutbox.groupBy({ by: ['status'], where: { organisationId }, _count: true }),
    readOperationsAlerts(organisationId),
  ] as const);
  const host = safeHostStatus(result[2].status === 'fulfilled' ? result[2].value : null);
  const history = safeMonitorHistory(result[3].status === 'fulfilled' ? result[3].value : null);
  const latest = history[0]; const hostFresh = Boolean(host && recent(host.checkedAt, 3 * 60_000));
  const backup = result[1].status === 'fulfilled' ? result[1].value : null;
  const cards: DiagnosticCard[] = [
    { id: 'website', title: 'Website', state: 'good', value: 'Responding now', detail: 'This authenticated dashboard request reached the application.', checkedAt, next: 'If the site cannot open, use your external alert messages and GitHub monitor history.' },
    { id: 'database', title: 'Database', state: result[0].status === 'fulfilled' ? 'good' : 'critical', value: result[0].status === 'fulfilled' ? 'Read check passed' : 'Read check failed', detail: 'A read-only database query; no customer records changed.', checkedAt, next: 'Refresh once. If it still fails, investigate the Hostinger application/database logs before retrying business actions.' },
    { id: 'disk', title: 'Server storage', state: !hostFresh || host?.diskUsedPercent == null ? 'unknown' : host.diskUsedPercent >= 85 ? 'critical' : host.diskUsedPercent >= 75 ? 'warning' : 'good', value: host?.diskUsedPercent == null ? 'Not available' : `${host.diskUsedPercent}% used`, detail: hostFresh ? 'Hostinger server disk; failure alert threshold 85%.' : 'Server evidence is missing or older than three minutes.', checkedAt: host?.checkedAt ?? null, next: 'Review server disk usage and retained backups. Do not delete backups or database files without a recovery plan.' },
    { id: 'memory', title: 'Server memory', state: !hostFresh || host?.memoryAvailablePercent == null ? 'unknown' : host.memoryAvailablePercent <= 10 ? 'critical' : host.memoryAvailablePercent <= 20 ? 'warning' : 'good', value: host?.memoryAvailablePercent == null ? 'Not available' : `${host.memoryAvailablePercent}% available`, detail: hostFresh ? 'Available host memory; failure alert threshold 10%.' : 'Server evidence is missing or older than three minutes.', checkedAt: host?.checkedAt ?? null, next: 'Check Hostinger resource use and recent releases. Investigate memory pressure before restarting any service.' },
    { id: 'backup', title: 'Encrypted local backup', state: backup?.fresh ? 'good' : 'critical', value: backup?.fresh ? 'Fresh and verified' : 'Freshness not verified', detail: 'Daily encrypted database backup; freshness limit 26 hours. Off-server recovery is a separate open gate.', checkedAt: backup?.completedAt ?? null, next: 'Review the backup timer and its failure logs. Preserve the last known usable backup.', href: '/audit/data-protection' },
    { id: 'monitor', title: 'External monitor', state: !latest || !recent(latest.checkedAt, 30 * 60_000) ? 'unknown' : latest.readiness !== 'success' || latest.backup !== 'success' || latest.status === 'UNAVAILABLE' || latest.channels.some(c => c.failed > 0) ? 'critical' : 'good', value: !latest ? 'No evidence yet' : !recent(latest.checkedAt, 30 * 60_000) ? 'Evidence is stale' : latest.readiness === 'success' && latest.backup === 'success' && latest.status !== 'UNAVAILABLE' && !latest.channels.some(c => c.failed > 0) ? 'Latest check passed' : 'Needs investigation', detail: 'Checks website, backup and server resources outside the website. Expected roughly every ten minutes; scheduling is not guaranteed.', checkedAt: latest?.checkedAt ?? null, next: 'Open the monitor run. Check which job failed; stale evidence may mean the monitor or evidence transfer stopped.', href: latest ? `https://github.com/blendproperty/stor24-portal/actions/runs/${latest.runId}` : 'https://github.com/blendproperty/stor24-portal/actions/workflows/monitor-production.yml' },
  ];
  const connections = result[4].status === 'fulfilled' ? result[4].value.map(row => ({ provider: knownProviders[row.provider.toUpperCase()] ?? 'Other integration', status: row.status, checkedAt: row.lastHealthAt?.toISOString() ?? null, stale: !recent(row.lastHealthAt?.toISOString(), 24 * 3600_000) })) : null;
  const queue = (index: 5 | 6) => { const r = result[index]; return r.status === 'fulfilled' ? { pending: r.value.filter(row => row.status === 'PENDING' || row.status === 'PROCESSING').reduce((sum, row) => sum + row._count, 0), failed: r.value.filter(row => row.status === 'FAILED' || row.status === 'DEAD_LETTER').reduce((sum, row) => sum + row._count, 0) } : null; };
  return { checkedAt, cards, host, hostFresh, backup, history, connections, queues: { incoming: queue(5), outgoing: queue(6) },
    messagingConfigured: [...configuredMessagingChannels(process.env)],
    activeRecipients: result[7].status === 'fulfilled' ? result[7].value.recipients.filter(r => r.enabled).length : null };
}
export type OperationsDiagnostics = Awaited<ReturnType<typeof operationsDiagnostics>>;
