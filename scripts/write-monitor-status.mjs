import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeMonitorEntry, safeMonitorHistory } from '../src/lib/operations-status-policy.mjs';
export async function saveMonitor(input, root = '/opt/backups/stor24-dlp/status') {
  const entry = safeMonitorEntry(input);
  if (!entry) throw new Error('INVALID_MONITOR_REPORT');
  const target = path.join(root, 'monitor.json'); let previous = [];
  try { const file = await readFile(target, 'utf8'); if (file.length <= 64_000) previous = safeMonitorHistory(JSON.parse(file)); } catch {}
  const records = safeMonitorHistory([entry, ...previous]);
  const temporary = path.join(root, `.monitor-${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify(records), { flag: 'wx', mode: 0o644 }); await rename(temporary, target); }
  finally { await unlink(temporary).catch(() => {}); }
  return records;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 24_000) throw new Error('REPORT_TOO_LARGE'); } await saveMonitor(JSON.parse(input)); console.log('Aggregate monitoring evidence saved.'); }
  catch { console.error('Monitoring evidence could not be saved.'); process.exitCode = 1; }
}
