import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { defaultLeadSla } from '../../src/lib/lead-sla-policy';
import { captureWhatChimpEnquiry } from '../../src/lib/whatchimp-enquiry-service';
import { enquiryFields, keyHash, WHAT_CHIMP_DOMAIN, WHAT_CHIMP_SESSION } from '../../src/lib/whatchimp-enquiry-contract';
import { POST } from '../../src/app/api/integrations/whatchimp/enquiry/route';

test('isolated WhatChimp intake saves progressive answers, preserves staff state and queues one after-hours task', async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, 'isolated-ci');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'localhost');
  const seed = randomUUID(), token = `fixture_${seed}_${seed}`;
  const org = await db.organisation.create({ data: { name: 'WhatChimp fixture', slug: seed } });
  const another = await db.organisation.create({ data: { name: 'Other fixture', slug: seed + '-other' } });
  try {
    const facility = await db.facility.create({ data: { organisationId: org.id, code: seed, name: 'Fixture Midpoint' } });
    const config = await db.configurationProfile.create({ data: { organisationId: org.id, facilityId: facility.id, domain: WHAT_CHIMP_DOMAIN, name: 'bot475943', status: 'READY', config: { enabled: true, botId: '475943', keyHash: keyHash(token), facilityId: facility.id } } });
    const policy = await db.configurationProfile.create({ data: { organisationId: org.id, facilityId: facility.id, domain: 'LEAD_SLA', name: 'policy', status: 'READY', config: { ...defaultLeadSla, windows: [1,2,3,4,5,6].map(day => ({ day, start: 420, end: 1140 })), holidays: ['2026-11-04'] } } });
    const during = new Date('2026-10-13T08:00:00Z'), after = new Date('2026-10-13T18:00:00Z');
    const base = { botId: '475943' as const, phone: '+27810000001' };
    const call = (input: Parameters<typeof captureWhatChimpEnquiry>[1], date = after) => captureWhatChimpEnquiry(config.id, input, date, keyHash(token));
    const probe = await call({ action: 'probe', botId: '475943' });
    assert.equal(probe.routing, 'AFTER_HOURS');
    assert.equal(await db.lead.count({ where: { facilityId: facility.id } }), 0);
    const starts = await Promise.all([call({ ...base, action: 'start' }), call({ ...base, action: 'start' })]);
    assert.equal(starts[0].phase, 'START');
    assert.equal(starts[0].enquiryKey, starts[1].enquiryKey);
    const enquiryKey = starts[0].enquiryKey!;
    assert.equal(await db.lead.count({ where: { facilityId: facility.id } }), 1);
    await assert.rejects(call({ ...base, action: 'submit', enquiryKey }), /INTAKE_INCOMPLETE/);
    await assert.rejects(call({ ...base, phone: '+27810000002', action: 'update', enquiryKey, field: 'items', value: 'Boxes' }), /INTAKE_NOT_FOUND/);
    const answers = { use: 'Personal', items: 'Sofa and 10 boxes', start: 'End of month', duration: 'Over 3 months', size: 'Not sure', viewing: 'Yes', name: 'Fixture Person' };
    for (const field of enquiryFields) {
      assert.equal((await call({ ...base, action: 'update', enquiryKey, field, value: answers[field] })).phase, `SAVE_${field.toUpperCase()}`);
      const record = await db.configurationProfile.findFirstOrThrow({ where: { organisationId: org.id, facilityId: facility.id, domain: WHAT_CHIMP_SESSION, name: enquiryKey } });
      assert.equal((record.config as { answers: Record<string, string> }).answers[field], answers[field]);
    }
    const lead = await db.lead.findUniqueOrThrow({ where: { id: starts[0].leadReference! } });
    assert.equal(lead.source, 'WhatsApp'); assert.ok(lead.customerId);
    await db.lead.update({ where: { id: lead.id }, data: { notes: lead.notes + '\n\nStaff note stays intact.', stage: 'QUALIFIED' } });
    const submitted = await Promise.all([call({ ...base, action: 'submit', enquiryKey }), call({ ...base, action: 'submit', enquiryKey })]);
    assert.equal(submitted[0].routing, 'AFTER_HOURS');
    assert.equal(submitted[0].phase, 'SUBMITTED');
    assert.equal(submitted[0].nextOpening, '2026-10-14T05:00:00.000Z');
    assert.equal(await db.task.count({ where: { organisationId: org.id } }), 1);
    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(updated.stage, 'QUALIFIED'); assert.ok(updated.notes?.includes('Staff note stays intact.'));
    await call({ ...base, action: 'route' });
    assert.equal(await db.lead.count({ where: { facilityId: facility.id } }), 1);
    assert.equal(await db.task.count({ where: { organisationId: org.id } }), 1);
    await assert.rejects(call({ ...base, action: 'update', enquiryKey, field: 'items', value: 'Changed after submission' }), /INTAKE_SUBMITTED/);
    const next = await call({ ...base, action: 'start' }, during);
    assert.notEqual(next.enquiryKey, enquiryKey); assert.equal(next.routing, 'STAFF');
    await db.configurationProfile.update({ where: { id: policy.id }, data: { config: { ...defaultLeadSla, windows: [{ day: 2, start: 1000, end: 1140 }] } } });
    assert.equal((await call({ action: 'probe', botId: '475943' }, during)).staffed, false);
    assert.equal((await POST(new Request('http://localhost/api/integrations/whatchimp/enquiry', { method: 'POST', body: '{}' }))).status, 401);
    const response = await POST(new Request('http://localhost/api/integrations/whatchimp/enquiry', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'probe', botId: '475943', organisationId: another.id }) }));
    assert.equal(response.status, 422);
    assert.equal(await db.customer.count({ where: { organisationId: another.id } }), 0);
    assert.equal(await db.reservation.count({ where: { facilityId: facility.id } }), 0);
    assert.equal(await db.communicationLog.count({ where: { organisationId: org.id } }), 0);
    await db.configurationProfile.update({ where: { id: config.id }, data: { config: { enabled: false, botId: '475943', keyHash: keyHash(token), facilityId: facility.id } } });
    await assert.rejects(call({ action: 'probe', botId: '475943' }), /INTAKE_DISABLED/);
  } finally { await db.organisation.delete({ where: { id: org.id } }); await db.organisation.delete({ where: { id: another.id } }); await db.$disconnect(); }
});
