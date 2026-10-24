import { safeHeartbeat } from './host-heartbeat-policy.mjs';
import { safeMonitorEntry } from '../src/lib/operations-status-policy.mjs';

function authenticated(request, key) {
  const supplied = request.headers.get('authorization') || '';
  if (!/^[a-f0-9]{64}$/.test(key || '') || !/^Bearer [a-f0-9]{64}$/.test(supplied)) return false;
  const expected = `Bearer ${key}`;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}
async function boundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('EMPTY');
  let size = 0; const parts = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 24_000) throw new Error('LARGE'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const monitorTrigger = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const type = url.pathname === '/_operations/monitor/host' ? 'host' : url.pathname === '/_operations/monitor/dashboard' ? 'dashboard' : null;
    const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!type) return reply({ error: 'Not found' }, 404);
    if (!authenticated(request, env.STOR24_HEARTBEAT_KEY)) return reply({ error: 'Unauthorised' }, 401);
    if (!env.MONITOR_EVIDENCE) return reply({ error: 'Unavailable' }, 503);
    try {
      if (request.method === 'GET') return reply(await env.MONITOR_EVIDENCE.get(type, 'json') || (type === 'host' ? { report: null } : { entry: null }));
      if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
      const input = await boundedBody(request);
      const value = type === 'host' ? safeHeartbeat(input) : safeMonitorEntry(input);
      const age = Date.now() - Date.parse(value?.checkedAt);
      if (!value || !Number.isFinite(age) || age < -60_000 || age > 60_000) return reply({ error: 'Invalid report' }, 400);
      const previous = await env.MONITOR_EVIDENCE.get(type, 'json');
      const prior = previous?.report || previous?.entry;
      // Retried uploads are idempotent; older observations cannot refresh their age.
      if (prior && Date.parse(prior.checkedAt) >= Date.parse(value.checkedAt)) return reply({ accepted: JSON.stringify(prior) === JSON.stringify(value) }, JSON.stringify(prior) === JSON.stringify(value) ? 200 : 409);
      await env.MONITOR_EVIDENCE.put(type, JSON.stringify(type === 'host' ? { receivedAt: new Date().toISOString(), report: value } : { entry: value }), { expirationTtl: type === 'host' ? 86400 : 30 * 86400 });
      return reply({ accepted: true });
    } catch { return reply({ error: 'Report unavailable or invalid' }, 503); }
  },
  async scheduled(_event, env) {
    const token = env.GITHUB_MONITOR_TOKEN;
    if (typeof token !== 'string' || !token.trim()) throw new Error('Missing GitHub monitor token');
    let response;
    try {
      response = await fetch('https://api.github.com/repos/blendproperty/stor24-portal/actions/workflows/monitor-production.yml/dispatches', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'STOR24-independent-monitor' },
        body: JSON.stringify({ ref: 'main', inputs: { test_alert: false } }),
      });
    } catch { throw new Error('GitHub monitor dispatch request failed; no automatic replay'); }
    if (!response.ok) throw new Error(`GitHub monitor dispatch failed: HTTP ${response.status}`);
    console.info('STOR24 monitor dispatch accepted', response.status);
  },
};

export default monitorTrigger;
