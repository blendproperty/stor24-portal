import { writeFileSync } from 'node:fs';
import { get, Agent } from 'node:http';
if (process.env.STOR24_STAGING_CAPACITY_TEST !== 'isolated-loopback' || process.env.TENANT_PORTAL_ORGANISATION_SLUG !== 'synthetic-staging') throw new Error('STAGING_CAPACITY_OPT_IN_REQUIRED');
// Execute inside the isolated staging app; there is no public/host port or provider URL.
const agent = new Agent({ keepAlive: true, maxSockets: 50 });
function readLocalHealth() {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port: 3000, path: '/api/health', agent, signal: AbortSignal.timeout(10000) }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 4096) response.destroy(new Error('STAGING_HEALTH_RESPONSE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode !== 200 || body.status !== 'ok' || body.database !== 'ok') throw new Error('STAGING_HEALTH_FAILED');
          resolve();
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
  });
}
const phases = [];
for (const concurrent of [10, 25, 50]) {
  const timings = [];
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrent }, async () => {
    for (let request = 0; request < 4; request++) {
      const before = performance.now();
      await readLocalHealth();
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
agent.destroy();
