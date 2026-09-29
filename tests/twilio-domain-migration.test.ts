import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validTwilioSignature } from "../src/lib/twilio-webhooks";

test("domain migration preserves authentic old callbacks without trusting request hosts", () => {
  const keys = ["APP_URL", "TWILIO_AUTH_TOKEN", "TWILIO_LEGACY_WEBHOOK_ORIGIN"] as const;
  const previous = keys.map(key => process.env[key]);
  const current = "https://portal.stor24.co.za";
  const legacy = "https://stor24-site.srv938083.hstgr.cloud";
  const path = "/api/webhooks/twilio/status";
  const entries = [["MessageSid", "SM-SYNTHETIC"], ["MessageStatus", "delivered"]] as const;
  const request = (origin: string, suffix = "?channel=whatsapp") => {
    const source = `${origin}${path}${suffix}MessageSidSM-SYNTHETICMessageStatusdelivered`;
    return new Request(`http://internal${path}?channel=whatsapp`, { method: "POST", headers: {
      "x-twilio-signature": createHmac("sha1", "synthetic-test-token").update(source).digest("base64"),
      "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "https",
    } });
  };
  try {
    process.env.APP_URL = current;
    process.env.TWILIO_AUTH_TOKEN = "synthetic-test-token";
    delete process.env.TWILIO_LEGACY_WEBHOOK_ORIGIN;
    assert.equal(validTwilioSignature(request(current), entries, path), true);
    assert.equal(validTwilioSignature(request(legacy), entries, path), false);
    process.env.TWILIO_LEGACY_WEBHOOK_ORIGIN = legacy;
    assert.equal(validTwilioSignature(request(legacy), entries, path), true);
    assert.equal(validTwilioSignature(request(current), entries, path), true);
    assert.equal(validTwilioSignature(request("https://attacker.invalid"), entries, path), false);
    assert.equal(validTwilioSignature(request(legacy, "?channel=sms"), entries, path), false);
    assert.equal(validTwilioSignature(request(legacy), [...entries, ["ErrorCode", "30003"]], path), false);
    assert.equal(validTwilioSignature(request(legacy), entries, "/api/webhooks/twilio/inbound"), false);
    process.env.TWILIO_LEGACY_WEBHOOK_ORIGIN = legacy + "/unexpected-path";
    assert.equal(validTwilioSignature(request(legacy), entries, path), false);
    delete process.env.TWILIO_AUTH_TOKEN;
    assert.equal(validTwilioSignature(request(current), entries, path), false);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
