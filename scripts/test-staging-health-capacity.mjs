import { writeFileSync } from 'node:fs';
if (process.env.STOR24_STAGING_CAPACITY_TEST !== 'isolated-loopback' || process.env.TENANT_PORTAL_ORGANISATION_SLUG !== 'synthetic-staging') throw new Error('STAGING_CAPACITY_OPT_IN_REQUIRED');
// Execute inside the isolated staging app; there is no public/host port or provider URL.
const url = 'http://127.0.0.1:3000/api/health';
const phases = [];
for (const concurrent of [10, 25, 50]) {
  const timings = [];
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrent }, async () => {
    for (let request = 0; request < 4; request++) {
      const before = performance.now();
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      const body = await response.json();
      if (!response.ok || body.status !== 'ok' || body.database !== 'ok') throw new Error('STAGING_HEALTH_FAILED');
      timings.push(performance.now() - before);
    }
  }));
  timings.sort((a, b) => a - b);
  const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
  if (p95Ms > 5000) throw new Error('STAGING_QUEUE_LATENCY_EXCEEDED');
  phases.push({ concurrent, requests: timings.length, errors: 0, p95Ms, elapsedMs: performance.now() - start });
}
const evidence = { verifiedAt: new Date().toISOString(), scope: 'private staging HTTP/database health only; not authenticated business-workflow capacity', phases };
writeFileSync('/tmp/stor24-staging-capacity.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
