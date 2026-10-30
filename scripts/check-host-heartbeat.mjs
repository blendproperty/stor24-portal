import { pathToFileURL } from 'node:url';
import { freshHeartbeat, monitorRequest, safeSecurityFindings } from './host-heartbeat-policy.mjs';
export async function checkHostHeartbeat(env, fetcher = fetch) {
  if (!['', 'false', 'true'].includes(env.STOR24_SECURITY_CHANGES_REQUIRED || '')) return { ok: false, markers: ['STOR24_SECURITY_CHECK_UNAVAILABLE'] };
  let record;
  try { record = await monitorRequest(env, 'host', { fetcher }); }
  catch { return { ok: false, markers: ['STOR24_HOST_REPORT_UNAVAILABLE'] }; }
  const retained = record.securityFindings ? safeSecurityFindings(record.securityFindings) : null;
  if (record.securityFindings && !retained) return { ok: false, markers: ['STOR24_SECURITY_CHECK_UNAVAILABLE'] };
  const report = freshHeartbeat(record);
  if (!report) return { ok: false, markers: [...(retained?.markers || []), 'STOR24_HOST_HEARTBEAT_MISSING'] };
  const securityRequired = env.STOR24_SECURITY_CHANGES_REQUIRED === 'true';
  const markers = [...new Set([...report.markers, ...(retained?.markers || []), ...(securityRequired && !Object.hasOwn(report, 'security') ? ['STOR24_SECURITY_CHECK_UNAVAILABLE'] : [])])];
  const ok = report.backup === 'success' && report.resources === 'success' && (!Object.hasOwn(report, 'security') || report.security === 'success') && !markers.length;
  return { ok, markers: ok ? ['STOR24_HOST_CHECKS_OK'] : markers.length ? markers : ['STOR24_HOST_CHECK_UNAVAILABLE'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkHostHeartbeat(process.env);
  result.markers.forEach(marker => console.log(marker));
  if (!result.ok) process.exitCode = 1;
}
