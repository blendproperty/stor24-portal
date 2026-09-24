import assert from "node:assert/strict";
import test from "node:test";
import { bookingPreferenceRecord } from "../src/lib/privacy-preferences";
import { privacyNoticeVersion } from "../src/lib/privacy-notice";

test("booking preferences record explicit choices and attributable notice evidence", () => {
  const record = bookingPreferenceRecord({ sms: true, email: false }, privacyNoticeVersion, "PUBLIC_WEBSITE", new Date("2026-09-24T12:00:00Z"));
  assert.equal(record.sms, true); assert.equal(record.email, false);
  assert.equal(record.phone, false); assert.equal(record.whatsapp, false);
  assert.equal(record.marketing, false); assert.equal(record.noticeVersion, privacyNoticeVersion);
  assert.match(record.noticeSha256!, /^[a-f0-9]{64}$/);
  assert.equal(record.recordedAt, "2026-09-24T12:00:00.000Z");
  assert.equal(record.source, "PUBLIC_WEBSITE");
});
test("legacy or unknown notice submissions do not invent notice acceptance", () => {
  for (const version of [undefined, "unknown"]) {
    const record = bookingPreferenceRecord({}, version, "PUBLIC_QUOTE_FORM");
    assert.equal(record.noticeVersion, null); assert.equal(record.noticeSha256, null);
    assert.equal(record.email || record.sms || record.phone || record.whatsapp || record.marketing, false);
  }
});
