import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { readOperationsAlerts, saveOperationsAlerts } from '../../src/lib/operations-alerts';

test('isolated PostgreSQL recipient scope, concurrent owner revision and audit rollback', async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, 'isolated-ci');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'localhost');
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: 'Alert CI', slug: key } });
  const foreign = await db.organisation.create({ data: { name: 'Foreign CI', slug: randomUUID() } });
  const user = await db.user.create({ data: { organisationId: org.id, name: 'Synthetic owner', email: `${key}@example.invalid` } });
  const row = { id: randomUUID(), name: 'Synthetic', email: 'recipient@example.invalid', mobile: '', channels: ['EMAIL'], enabled: true, consent: true };
  let constraint = false;
  try {
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_alert_audit_failure CHECK (false) NOT VALID'); constraint = true;
    await assert.rejects(saveOperationsAlerts(org.id, user.id, [row], null));
    assert.equal((await readOperationsAlerts(org.id)).recipients.length, 0);
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_alert_audit_failure'); constraint = false;
    const saved = await saveOperationsAlerts(org.id, user.id, [row], null);
    assert.deepEqual((await readOperationsAlerts(foreign.id)).recipients, []);
    const results = await Promise.allSettled(['First', 'Second'].map(name => saveOperationsAlerts(org.id, user.id, [{ ...row, name }], saved.revision)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, domain: 'OPERATIONS_ALERTS' } }), 1);
    const audits = await db.auditEvent.findMany({ where: { organisationId: org.id, action: 'operations.alert_recipients.updated' } });
    assert.equal(audits.length, 2); assert.doesNotMatch(JSON.stringify(audits), /recipient@example.invalid/);
  } finally {
    if (constraint) await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_alert_audit_failure');
    await db.$disconnect();
  }
});
