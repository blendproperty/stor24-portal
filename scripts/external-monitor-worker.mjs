const monitorTrigger = {
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
