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


test('origin transport failure is unverified; unexpected HTTP is a distinct urgent finding', () => {
  const failed = { ...env, READINESS_RESULT: 'failure', BACKUP_RESULT: 'success' };
  const transport = alertDetails({ ...failed, READINESS_LOG: '2026-10-23T11:03:52Z STOR24_ORIGIN_UNVERIFIED host=stor24.co.za probe=forged curl=28 attempts=3\nPRIVATE_TOKEN' }, 'FAILURE');
  assert.equal(transport.severity, 'WARNING'); assert.match(transport.text, /stor24.co.za.*forged.*curl 28.*3 attempt/);
  assert.match(transport.text, /no successful bypass/); assert.doesNotMatch(transport.text, /PRIVATE_TOKEN/);
  const bypass = alertDetails({ ...failed, READINESS_LOG: 'STOR24_ORIGIN_FAILED host=portal.stor24.co.za probe=plain http=200\n' }, 'FAILURE');
  assert.equal(bypass.severity, 'HIGH'); assert.match(bypass.text, /portal.stor24.co.za.*HTTP 200.*expected 403/);
});

test('all failed validations and simultaneous backup failures are reported without raw logs', () => {
  const detail = alertDetails({ ...env, READINESS_RESULT: 'failure', READINESS_LOG: 'STOR24_PUBLIC_FAILED check=application\nSTOR24_PUBLIC_FAILED check=database\n', BACKUP_LOG: 'STOR24_BACKUP_FAILED\nPRIVATE_HOST' }, 'FAILURE');
  assert.match(detail.text, /application, database/); assert.match(detail.text, /Encrypted backup verification failed/);
  assert.doesNotMatch(detail.text, /PRIVATE_HOST/); assert.equal(detail.severity, 'HIGH');
});

test('metadata identifies the failed step without logs; shell source is never backup evidence', () => {
  const detail = alertDetails({ ...env, READINESS_RESULT: 'failure', BACKUP_RESULT: 'success', READINESS_STEPS: [{ name: 'Verify public application and database readiness', conclusion: 'success' }, { name: 'Verify Cloudflare origin protection cannot be bypassed directly', conclusion: 'failure' }] }, 'FAILURE');
  assert.match(detail.text, /Public application\/database readiness passed/);
  assert.equal(detail.severity, 'WARNING');
  assert.equal(backupEvidence("command '/bin/bash check || { echo STOR24_BACKUP_FAILED; exit 1; }'"), null);
  assert.match(backupEvidence('STOR24_RESOURCES_FAILED\n').failure, /resource/);
  const command = 'command check || { echo STOR24_BACKUP_FAILED; }; resources || { echo STOR24_RESOURCES_FAILED; }';
  assert.equal(backupEvidence(command), null);
  assert.equal(backupEvidence(command + '\nssh: connect to host PRIVATE_HOST port 22: Connection timed out').severity, 'WARNING');
  assert.match(backupEvidence('2026-10-24T05:00:00Z STOR24_BACKUP_FAILED\n2026-10-24T05:00:01Z STOR24_RESOURCES_FAILED\n').failure, /backup and server resource/);
});
