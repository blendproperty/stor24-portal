import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { freshHeartbeat, monitorRequest } from './host-heartbeat-policy.mjs';
export async function checkHostHeartbeat(env, fetcher = fetch) {
  let record;
  try { record = await monitorRequest(env, 'host', { fetcher }); }
  catch { return { ok: false, markers: ['STOR24_HOST_REPORT_UNAVAILABLE'] }; }
  const report = freshHeartbeat(record);
  if (!report) return { ok: false, markers: ['STOR24_HOST_HEARTBEAT_MISSING'] };
  const ok = report.backup === 'success' && report.resources === 'success';
  return { ok, markers: ok ? ['STOR24_HOST_CHECKS_OK'] : report.markers.length ? report.markers : ['STOR24_HOST_CHECK_UNAVAILABLE'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkHostHeartbeat(process.env);
  result.markers.forEach(marker => console.log(marker));
  if (process.argv.includes('--record-outcome') && process.env.GITHUB_OUTPUT) {
    // The workflow restores this result as the job conclusion after planning/publication.
    appendFileSync(process.env.GITHUB_OUTPUT, `result=${result.ok ? 'success' : 'failure'}\n`);
  } else if (!result.ok) process.exitCode = 1;
}
