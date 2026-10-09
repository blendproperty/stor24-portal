import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupEvidence, alertDetails } from '../scripts/production-alert-details.mjs';
const env = { READINESS_RESULT: 'success', BACKUP_RESULT: 'failure', GITHUB_REPOSITORY: 'blendproperty/stor24-portal', GITHUB_RUN_ID: '123' };
test('SSH timeout is monitoring warning, never a claimed failed backup', () => {
  const d = alertDetails({ ...env, BACKUP_LOG: 'ssh: connect to host PRIVATE_HOST port 22: Connection timed out' }, 'FAILURE', new Date('2026-10-08T21:42:23.201Z'));
  assert.equal(d.severity, 'WARNING');
  assert.match(d.text, /23:42:23 SAST/);
  assert.match(d.text, /could not run/);
  assert.doesNotMatch(d.text, /PRIVATE_HOST/);
  assert.equal(d.priority, 'Prompt');
  assert.match(d.timeframe, /Within 2 hours/);
  assert.match(d.summary, /retry the read-only monitor/);
  assert.match(d.text, /Escalation:/);
});
test('recovery contains measured aggregate evidence', () => {
  const d = alertDetails({ ...env, BACKUP_RESULT: 'success', BACKUP_LOG: 'Encrypted backup freshness verified\nHost disk 58%; available memory 63%; database connections 8/100; app healthy, no OOM' }, 'RECOVERY');
  assert.equal(d.severity, 'INFO');
  assert.match(d.text, /58%.*63%.*8\/100/);
  assert.match(d.text, /not outage duration/);
  assert.match(d.html, /<table/);
  assert.equal(d.priority, 'Follow-up');
  assert.match(d.timeframe, /Next business day, if checks remain healthy/);
});
test('resource thresholds and readiness raise severity while missing logs remain unknown', () => {
  assert.equal(backupEvidence('HOST_DISK_THRESHOLD').severity, 'HIGH');
  assert.equal(backupEvidence('HOST_MEMORY_THRESHOLD').severity, 'HIGH');
  assert.equal(backupEvidence('DATABASE_CONNECTION_THRESHOLD').severity, 'HIGH');
  assert.equal(alertDetails({ ...env, READINESS_RESULT: 'failure' }, 'FAILURE').severity, 'HIGH');
  assert.equal(alertDetails({ ...env, READINESS_RESULT: 'failure' }, 'FAILURE').priority, 'Urgent');
  assert.match(alertDetails({ ...env, READINESS_RESULT: 'failure' }, 'FAILURE').timeframe, /Immediately/);
  assert.match(alertDetails(env, 'FAILURE').timeframe, /do not defer/);
  assert.match(alertDetails(env, 'FAILURE').text, /specific cause unavailable/);
});
test('test notifications cannot falsely declare that no outage exists', () => {
  const d = alertDetails({ ...env, READINESS_RESULT: 'failure' }, 'TEST');
  assert.equal(d.severity, 'INFO');
  assert.match(d.text, /does not establish service health/);
});
