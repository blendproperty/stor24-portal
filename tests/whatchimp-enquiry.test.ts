import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLeadSla } from '../src/lib/lead-sla-policy';
import { enquiryRequestSchema, intakeCalendar, intakeHours, keyHash, matchesIntakeKey } from '../src/lib/whatchimp-enquiry-contract';
const calendar = { ...defaultLeadSla, windows: [1,2,3,4,5,6].map(day => ({ day, start: 420, end: 1140 })), holidays: ['2026-11-04'] };
test('saved South Africa hours route correctly at opening, closing, Sunday and holidays', () => {
  assert.equal(intakeHours(new Date('2026-10-13T05:00:00Z'), calendar).staffed, true);
  assert.equal(intakeHours(new Date('2026-10-13T16:59:59Z'), calendar).staffed, true);
  assert.equal(intakeHours(new Date('2026-10-13T17:00:00Z'), calendar).staffed, false);
  assert.equal(intakeHours(new Date('2026-10-13T17:00:00Z'), calendar).nextOpening?.toISOString(), '2026-10-14T05:00:00.000Z');
  assert.equal(intakeHours(new Date('2026-10-17T17:00:00Z'), calendar).nextOpening?.toISOString(), '2026-10-19T05:00:00.000Z');
  assert.equal(intakeHours(new Date('2026-11-04T08:00:00Z'), calendar).nextOpening?.toISOString(), '2026-11-05T05:00:00.000Z');
  assert.equal(intakeHours(new Date(), null).confirmed, false);
});
test('saved policy wins and invalid calendars never guess example hours', () => {
  assert.deepEqual(intakeCalendar(calendar, null), calendar);
  assert.equal(intakeCalendar({ windows: [] }, null), null);
  assert.equal(intakeCalendar(undefined, undefined), null);
});
test('bot-only intake rejects unresolved fields, client organisation scope, malformed phones and missing session keys', () => {
  const base = { action: 'start', botId: '475943', phone: '27810000001' };
  assert.equal(enquiryRequestSchema.parse(base).phone, '+27810000001');
  assert.equal(enquiryRequestSchema.safeParse({ ...base, botId: '474865' }).success, false);
  assert.equal(enquiryRequestSchema.safeParse({ ...base, organisationId: 'other' }).success, false);
  assert.equal(enquiryRequestSchema.safeParse({ ...base, phone: '#PHONE#' }).success, false);
  assert.equal(enquiryRequestSchema.safeParse({ ...base, action: 'update', field: 'name', value: 'A name' }).success, false);
});
test('only the scoped integration key authenticates', () => {
  const key = 'fixture-only-'.repeat(4);
  assert.equal(matchesIntakeKey(key, keyHash(key)), true);
  assert.equal(matchesIntakeKey('unrelated-fixture-key-'.repeat(2), keyHash(key)), false);
  assert.equal(matchesIntakeKey('', keyHash(key)), false);
});
