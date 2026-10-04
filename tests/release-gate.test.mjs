import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseEvidence, requiredWorkflows } from '../scripts/verify-release.mjs';
const sha = 'a'.repeat(40);
const valid = requiredWorkflows.map((file, id) => ({ id, run_attempt: 1, path: `.github/workflows/${file}`, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }));
test('release requires all exact-main push evidence', () => {
  assert.ok(releaseEvidence(valid, sha).every(row => row.ready));
  for (const change of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { head_branch: 'candidate' }, { status: 'in_progress' }, { conclusion: 'failure' }]) {
    assert.ok(releaseEvidence(valid.map(row => ({ ...row, ...change })), sha).every(row => !row.ready));
  }
  assert.ok(releaseEvidence(valid.slice(1), sha).some(row => !row.ready));
});
test('a failed rerun cannot reuse an older passing result', () => {
  const retry = { ...valid[0], id: 100, conclusion: 'failure' };
  assert.ok(releaseEvidence([...valid, retry], sha)[0].failed);
  assert.ok(releaseEvidence([...valid, { ...valid[0], run_attempt: 2, conclusion: 'failure' }], sha)[0].failed);
});
