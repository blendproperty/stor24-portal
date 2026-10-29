import { pathToFileURL } from 'node:url';

export async function pingMonitorWatchdog(env, fetcher = fetch) {
  // A single-check URL cannot administer Healthchecks or access STOR24 data.
  const address = env.STOR24_WATCHDOG_PING_URL || '';
  if (!/^https:\/\/hc-ping\.com\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(address)) {
    throw new Error('STOR24_WATCHDOG_CONFIGURATION_REQUIRED');
  }
  const states = [env.READINESS_RESULT, env.BACKUP_RESULT, env.MONITOR_JOB_RESULT];
  if (states.some(value => !['success', 'failure', 'cancelled', 'skipped'].includes(value))) {
    throw new Error('STOR24_WATCHDOG_INVALID_RESULT');
  }
  const failed = states.some(value => value !== 'success');
  let response;
  try {
    response = await fetcher(address + (failed ? '/fail' : ''), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'STOR24-monitor-watchdog' },
    });
  } catch { throw new Error('STOR24_WATCHDOG_TRANSPORT_FAILED'); }
  if (!response.ok) throw new Error('STOR24_WATCHDOG_REJECTED');
  await response.body?.cancel();
  return failed ? 'STOR24_WATCHDOG_FAILURE_PUBLISHED' : 'STOR24_WATCHDOG_SUCCESS_PUBLISHED';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await pingMonitorWatchdog(process.env)); }
  catch {
    // Never expose the secret ping URL through a transport exception.
    console.error('STOR24_WATCHDOG_CHECKIN_FAILED'); process.exitCode = 1;
  }
}
