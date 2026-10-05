import { spawnSync } from 'node:child_process';
import { readFileSync, statfsSync } from 'node:fs';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export async function collect({ run = spawnSync, read = readFileSync, disk = statfsSync, root = '/opt/backups/stor24-dlp/status' } = {}) {
  const result = { checkedAt: new Date().toISOString(), diskUsedPercent: null, memoryAvailablePercent: null, databaseConnections: null, databaseLimit: null, appHealth: 'unknown', oomKilled: null, image: null };
  try { const s = disk('/'); result.diskUsedPercent = Math.round((1 - s.bavail / s.blocks) * 100); } catch {}
  try { const text = read('/proc/meminfo', 'utf8'); const available = Number(text.match(/^MemAvailable:\s+(\d+)/m)?.[1]); const total = Number(text.match(/^MemTotal:\s+(\d+)/m)?.[1]); if (total > 0) result.memoryAvailablePercent = Math.floor(available * 100 / total); } catch {}
  const command = args => { const r = run('docker', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 }); if (r.status !== 0) throw new Error('PROBE_UNAVAILABLE'); return r.stdout.trim(); };
  try { const a = JSON.parse(command(['inspect', '--format', '{"health":{{json .State.Health.Status}},"oom":{{json .State.OOMKilled}},"image":{{json .Config.Image}}}', 'stor24-crm-app-1'])); result.appHealth = a.health ?? 'unknown'; result.oomKilled = a.oom ?? null; result.image = a.image ?? null; } catch {}
  try { const n = command(['exec', 'stor24-crm-postgres-1', 'psql', '-U', 'stor24', '-d', 'stor24_crm', '-Atc', "SELECT count(*)::text || '/' || current_setting('max_connections') FROM pg_stat_activity;"]).split('/').map(Number); if (n.length === 2 && n.every(Number.isFinite)) [result.databaseConnections, result.databaseLimit] = n; } catch {}
  await mkdir(root, { recursive: true });
  const temporary = path.join(root, `.operations-${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify(result), { flag: 'wx', mode: 0o644 }); await rename(temporary, path.join(root, 'operations.json')); }
  finally { await unlink(temporary).catch(() => {}); }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) collect().catch(() => { console.error('Operations snapshot could not be saved.'); process.exitCode = 1; });
