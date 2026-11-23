import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { keyHash } from '../../src/lib/whatchimp-enquiry-contract';
import { SOCIAL_INTAKE_DOMAIN } from '../../src/lib/whatchimp-social-contract';
import { provisionSocialPair, revokeSocialPair } from '../../src/lib/whatchimp-social-provision';
import { POST } from '../../src/app/api/v1/integrations/whatchimp-social/route';
import { POST as intake } from '../../src/app/api/integrations/whatchimp/social/route';

test('provisioning creates two scoped keys once, without logging secrets', async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, 'isolated-ci');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'localhost');
  const id = randomUUID(), org = await db.organisation.create({ data: { name: 'Provision fixture', slug: id } });
  try {
    const facility = await db.facility.create({ data: { organisationId: org.id, code: id, name: 'Fixture' } });
    const owner = await db.user.create({ data: { organisationId: org.id, name: 'Owner', email: `owner-${id}@example.invalid`, passwordHash: 'fixture' } });
    const recipient = await db.user.create({ data: { organisationId: org.id, name: 'Staff', email: `staff-${id}@example.invalid` } });
    const ownerRole = await db.role.create({ data: { organisationId: org.id, name: 'Organisation owner', permissions: [] } });
    const staffRole = await db.role.create({ data: { organisationId: org.id, name: 'Lead manager', permissions: ['leads.view'] } });
    await db.roleAssignment.create({ data: { userId: owner.id, roleId: ownerRole.id } });
    await db.roleAssignment.create({ data: { userId: recipient.id, roleId: staffRole.id, facilityId: facility.id } });
    const actor = { id: owner.id, organisationId: org.id, sessionVersion: owner.sessionVersion };
    const input = { facilityId: facility.id, recipientUserId: recipient.id, recipientEmail: recipient.email, facebookBotId: randomUUID(), instagramBotId: randomUUID() };
    await assert.rejects(provisionSocialPair({ ...actor, sessionVersion: actor.sessionVersion + 1 }, input), /FORBIDDEN/);
    await assert.rejects(provisionSocialPair(actor, { ...input, facilityId: 'wrong-facility' }), /SOCIAL_SCOPE_INVALID/);
    await assert.rejects(provisionSocialPair(actor, { ...input, recipientEmail: 'wrong@example.invalid' }), /SOCIAL_SCOPE_INVALID/);
    assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, domain: SOCIAL_INTAKE_DOMAIN } }), 0);
    await db.roleAssignment.deleteMany({ where: { userId: recipient.id } });
    await assert.rejects(provisionSocialPair(actor, input), /SOCIAL_SCOPE_INVALID/);
    await db.roleAssignment.create({ data: { userId: recipient.id, roleId: staffRole.id, facilityId: facility.id } });
    const result = await provisionSocialPair(actor, input);
    assert.notEqual(result.facebook, result.instagram);
    const probe = (token: string) => intake(new Request('http://localhost/api/integrations/whatchimp/social', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"action":"probe"}' }));
    assert.equal((await probe(result.facebook)).status, 200); assert.equal((await probe(result.instagram)).status, 200);
    const profiles = await db.configurationProfile.findMany({ where: { organisationId: org.id, domain: SOCIAL_INTAKE_DOMAIN } });
    assert.equal(profiles.length, 2);
    for (const profile of profiles) {
      const config = profile.config as { channel: 'facebook' | 'instagram'; keyHash: string; facilityId: string; recipientUserId: string };
      assert.equal(profile.status, 'READY'); assert.equal(config.facilityId, facility.id); assert.equal(config.recipientUserId, recipient.id);
      assert.equal(config.keyHash, keyHash(result[config.channel]));
    }
    const audit = JSON.stringify(await db.auditEvent.findMany({ where: { organisationId: org.id } }));
    assert.ok(!audit.includes(result.facebook) && !audit.includes(result.instagram) && !audit.includes(keyHash(result.facebook)) && !audit.includes(keyHash(result.instagram)));
    await assert.rejects(provisionSocialPair(actor, input), /SOCIAL_CONNECTION_EXISTS/);
    assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, domain: SOCIAL_INTAKE_DOMAIN } }), 2);
    const pair = { facilityId: facility.id, facebookBotId: input.facebookBotId, instagramBotId: input.instagramBotId };
    await assert.rejects(revokeSocialPair(actor, { ...pair, instagramBotId: randomUUID() }), /SOCIAL_PAIR_NOT_FOUND/);
    assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, domain: SOCIAL_INTAKE_DOMAIN, status: 'READY' } }), 2);
    await revokeSocialPair(actor, pair);
    assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, domain: SOCIAL_INTAKE_DOMAIN, status: 'READY' } }), 0);
    assert.equal((await probe(result.facebook)).status, 401); assert.equal((await probe(result.instagram)).status, 401);
    const replacement = await provisionSocialPair(actor, input);
    assert.notEqual(replacement.facebook, result.facebook); assert.notEqual(replacement.instagram, result.instagram);
    await revokeSocialPair(actor, pair);
    const concurrent = await Promise.allSettled([provisionSocialPair(actor, input), provisionSocialPair(actor, input)]);
    assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, domain: SOCIAL_INTAKE_DOMAIN, status: 'READY' } }), 2);
    const request = new Request('http://localhost/api/v1/integrations/whatchimp-social', { method: 'POST', headers: { origin: 'https://other.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await POST(request)).status, 403);
  } finally { await db.organisation.delete({ where: { id: org.id } }); await db.$disconnect(); }
});
