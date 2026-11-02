import assert from "node:assert/strict";
import test from "node:test";
import { inspectReportExport } from "../src/lib/dlp-policy";
import { phoneNoticeAccountNumber } from "./phone-notice-fixture";

test("phone success fixtures avoid UUID payment-card false positives without changing DLP", () => {
  const key = "aaaaaaaa-aaaa-4aaa-8111-111111111112";
  const original = inspectReportExport("rent-roll", [{ customer: `Account PHONE-CI-${key}` }]);
  assert.equal(original.allowed, false);
  assert.ok(original.reasons.includes("PAYMENT_CARD_PATTERN"));
  const safe = phoneNoticeAccountNumber(key);
  assert.equal(inspectReportExport("rent-roll", [{ customer: `Account ${safe}` }]).allowed, true);
  assert.notEqual(safe, phoneNoticeAccountNumber(key.replace(/2$/, "3")));
});
