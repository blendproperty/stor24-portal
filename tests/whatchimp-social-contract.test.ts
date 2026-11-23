import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSocialPhone, socialRequest, socialConfig } from '../src/lib/whatchimp-social-contract';

test('social phone validation normalizes common formats and rejects short or malformed inputs', () => {
  assert.equal(normalizeSocialPhone('082 123 4567'), '+27821234567');
  assert.equal(normalizeSocialPhone('+27 (82) 123-4567'), '+27821234567');
  assert.equal(normalizeSocialPhone('+44 20 7946 0958'), '+442079460958');
  for (const input of ['123', '123456789', 'not a number', '082123', '+270821234567', '++27821234567', '1111111111', '#PHONE#']) assert.equal(normalizeSocialPhone(input), null, input);
});
test('social bot identifiers accept legacy numbers and new platform UUIDs only', () => {
  const config = { enabled: true, channel: 'facebook', keyHash: 'a'.repeat(64), facilityId: 'f', recipientUserId: 'u', recipientEmail: 'test@example.invalid' };
  for (const botId of ['72238', '173f453e-b374-4d1a-8f8f-b61a07ec5f1a']) assert.equal(socialConfig.safeParse({ ...config, botId }).success, true);
  for (const botId of ['', 'not-a-bot', '123x', '1234567890123456789012345678901']) assert.equal(socialConfig.safeParse({ ...config, botId }).success, false);
});
test('social requests do not accept arbitrary routing or unresolved answer fields', () => {
  assert.equal(socialRequest.safeParse({ action: 'probe', organisationId: 'other' }).success, false);
  assert.equal(socialRequest.safeParse({ action: 'submit', enquiryKey: 'not-a-uuid', name: 'A', phone: '123', requirements: 'Boxes', startDate: 'Soon' }).success, false);
  assert.equal(socialRequest.safeParse({ action: 'submit', enquiryKey: '00000000-0000-4000-8000-000000000000', name: '#NAME#', phone: '123', requirements: 'Boxes', startDate: 'Soon' }).success, false);
  assert.equal(socialConfig.safeParse({ enabled: true, channel: 'whatsapp', botId: '1', keyHash: 'a'.repeat(64), facilityId: 'f', recipientUserId: 'u', recipientEmail: 'test@example.invalid' }).success, false);
});
