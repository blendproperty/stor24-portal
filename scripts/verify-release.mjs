import { pathToFileURL } from 'node:url';

export const requiredWorkflows = ['ci.yml', 'security.yml', 'merchandise-transactions.yml'];

export function releaseEvidence(runs, sha) {
  return requiredWorkflows.map(file => {
    const latest = runs.filter(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push' && run.path === `.github/workflows/${file}`)
      .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
    return { file, ready: latest?.status === 'completed' && latest.conclusion === 'success', failed: latest?.status === 'completed' && latest.conclusion !== 'success' };
  });
}

async function verify() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, DEPLOY_REF, GITHUB_OUTPUT } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_OUTPUT || !/^(main|[a-f0-9]{40})$/.test(DEPLOY_REF ?? '')) throw new Error('INVALID_RELEASE_INPUT');
  async function api(path) {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`, {
      headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`RELEASE_API_FAILED:${response.status}`);
    return response.json();
  }
  const main = await api('git/ref/heads/main');
  const sha = main.object.sha;
  if (DEPLOY_REF !== 'main' && DEPLOY_REF !== sha) throw new Error('RELEASE_IS_NOT_CURRENT_MAIN');
  for (let attempt = 0; attempt < 90; attempt++) {
    const runs = await api(`actions/runs?head_sha=${sha}&event=push&per_page=100`);
    const evidence = releaseEvidence(runs.workflow_runs, sha);
    if (evidence.some(row => row.failed)) throw new Error('REQUIRED_RELEASE_CHECK_FAILED');
    if (evidence.every(row => row.ready)) {
      const current = await api('git/ref/heads/main');
      if (current.object.sha !== sha) throw new Error('MAIN_CHANGED_DURING_RELEASE_CHECK');
      const { appendFileSync } = await import('node:fs');
      appendFileSync(GITHUB_OUTPUT, `sha=${sha}\n`);
      console.log(`Verified exact-main CI, security and isolated transaction/restore evidence: ${sha}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('RELEASE_EVIDENCE_TIMEOUT');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verify().catch(error => { console.error(error.message); process.exitCode = 1; });
}
