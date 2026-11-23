import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { captureWhatChimpEnquiry } from '../../src/lib/whatchimp-enquiry-service';
import { sendWhatChimpNotice } from '../../src/lib/whatchimp-enquiry-notice';
import { keyHash, WHAT_CHIMP_DOMAIN, WHAT_CHIMP_NOTICE } from '../../src/lib/whatchimp-enquiry-contract';

test('WhatsApp capture assigns an authorised recipient and sends only one notice', async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, 'isolated-ci');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'localhost');
  const id = randomUUID(), token = `fixture_${id}_${id}`;
  const org = await db.organisation.create({ data: { name: 'WhatsApp fixture', slug: id } });
  try {
    const facility = await db.facility.create({ data: { organisationId: org.id, code: id, name: 'Fixture store' } });
    const user = await db.user.create({ data: { organisationId: org.id, name: 'Fixture staff', email: `${id}@example.invalid` } });
    const role = await db.role.create({ data: { organisationId: org.id, name: 'Fixture sales', permissions: ['leads.view', 'leads.manage'] } });
    await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: facility.id } });
    const config = await db.configurationProfile.create({ data: { organisationId: org.id, facilityId: facility.id, domain: WHAT_CHIMP_DOMAIN, name: 'bot475943', status: 'READY', config: { enabled: true, botId: '475943', keyHash: keyHash(token), facilityId: facility.id, recipientUserId: user.id, recipientEmail: user.email } } });
    const call = (phone: string) => captureWhatChimpEnquiry(config.id, { action: 'start', botId: '475943', phone }, new Date(), keyHash(token));
    const [one, again] = await Promise.all([call('+27810000001'), call('+27810000001')]);
    assert.equal(one.leadReference, again.leadReference);
    assert.equal((await db.lead.findUniqueOrThrow({ where: { id: one.leadReference! } })).assignedToId, user.id);
    const notice = await db.configurationProfile.findFirstOrThrow({ where: { organisationId: org.id, domain: WHAT_CHIMP_NOTICE, name: one.leadReference! } });
    let sent = 0;
    const send = async (message: { to: string; text: string }) => { sent++; assert.equal(message.to, user.email); assert.ok(!message.text.includes('27810000001')); };
    await Promise.all([sendWhatChimpNotice(notice.id, send), sendWhatChimpNotice(notice.id, send)]);
    assert.equal(sent, 1);
    assert.equal((await db.configurationProfile.findUniqueOrThrow({ where: { id: notice.id } })).status, 'ACCEPTED');
    const two = await call('+27810000002');
    const failed = await db.configurationProfile.findFirstOrThrow({ where: { organisationId: org.id, domain: WHAT_CHIMP_NOTICE, name: two.leadReference! } });
    await sendWhatChimpNotice(failed.id, async () => { throw Error('ambiguous'); });
    await sendWhatChimpNotice(failed.id, send);
    assert.equal(sent, 1);
    assert.equal((await db.configurationProfile.findUniqueOrThrow({ where: { id: failed.id } })).status, 'REVIEW_REQUIRED');
    await db.roleAssignment.deleteMany({ where: { userId: user.id } });
    const three = await call('+27810000003');
    assert.equal((await db.lead.findUniqueOrThrow({ where: { id: three.leadReference! } })).assignedToId, null);
    assert.equal((await db.configurationProfile.findFirstOrThrow({ where: { organisationId: org.id, domain: WHAT_CHIMP_NOTICE, name: three.leadReference! } })).status, 'REVIEW_REQUIRED');
  } finally { await db.organisation.delete({ where: { id: org.id } }); await db.$disconnect(); }
});
