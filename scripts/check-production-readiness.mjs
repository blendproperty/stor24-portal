import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const marker = /^(?:STOR24_READINESS_OK|STOR24_PUBLIC_FAILED check=(?:json|service|application|database|expiry-worker)|STOR24_PUBLIC_UNAVAILABLE curl=\d{1,3}|STOR24_ORIGIN_FAILED host=(?:stor24\.co\.za|www\.stor24\.co\.za|portal\.stor24\.co\.za|cms\.stor24\.co\.za) probe=(?:plain|forged) http=\d{3}|STOR24_ORIGIN_UNVERIFIED host=(?:stor24\.co\.za|www\.stor24\.co\.za|portal\.stor24\.co\.za|cms\.stor24\.co\.za) probe=(?:plain|forged) curl=\d{1,3} attempts=[123]|STOR24_READINESS_INCOMPLETE)$/;
const incomplete = () => ({ state: 'failed', markers: ['STOR24_READINESS_INCOMPLETE'] });

export function probeReadiness(execute = spawnSync) {
  for (const script of ['scripts/public-readiness.sh', 'scripts/origin-access-health.sh']) {
    const result = execute('bash', [script], { encoding: 'utf8', timeout: 400000, maxBuffer: 1024 * 1024 });
    if (!result.error && result.status === 0) continue;
    const markers = `${result.stdout || ''}\n${result.stderr || ''}`.split(/\r?\n/).filter(line => marker.test(line));
    if (!markers.length) return incomplete();
    const transportOnly = markers.every(line => /^(?:STOR24_PUBLIC_UNAVAILABLE|STOR24_ORIGIN_UNVERIFIED).*curl=(?:6|7|28|35|52|56)(?: |$)/.test(line));
    return { state: transportOnly ? 'unverified' : 'failed', markers };
  }
  return { state: 'healthy', markers: ['STOR24_READINESS_OK'] };
}

function checked(value) {
  try {
    const result = typeof value === 'string' ? JSON.parse(value) : value;
    if (!['healthy', 'unverified', 'failed'].includes(result?.state) || !Array.isArray(result.markers) ||
        !result.markers.length || result.markers.length > 8 || !result.markers.every(line => typeof line === 'string' && marker.test(line))) return incomplete();
    if (result.state === 'healthy' && (result.markers.length !== 1 || result.markers[0] !== 'STOR24_READINESS_OK')) return incomplete();
    if (result.state !== 'healthy' && result.markers.includes('STOR24_READINESS_OK')) return incomplete();
    if (result.state === 'unverified' && !result.markers.every(line => /^(?:STOR24_PUBLIC_UNAVAILABLE|STOR24_ORIGIN_UNVERIFIED).*curl=(?:6|7|28|35|52|56)(?: |$)/.test(line))) return incomplete();
    return result;
  } catch { return incomplete(); }
}

export function resolveReadiness(primary, confirmation) {
  const first = checked(primary);
  // A received bad health/HTTP/certificate result must never be voted away.
  if (first.state !== 'unverified') return first;
  const second = checked(confirmation);
  return second.state === 'unverified' ? { state: 'unverified', markers: [...new Set([...first.markers, ...second.markers])] } : second;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--resolve')) {
    const result = resolveReadiness(process.env.PRIMARY_FINDING, process.env.CONFIRMATION_FINDING);
    if (result.state === 'healthy' && checked(process.env.PRIMARY_FINDING).state === 'unverified') console.log('STOR24_MONITOR_PATH_RECOVERED primary=azure confirmation=macos');
    console.log(result.markers.join('\n'));
    if (result.state !== 'healthy') process.exitCode = 1;
  } else {
    const result = probeReadiness();
    console.log(result.markers.join('\n'));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${result.state}\nfinding=${JSON.stringify(result)}\n`);
    else if (result.state !== 'healthy') process.exitCode = 1;
  }
}
