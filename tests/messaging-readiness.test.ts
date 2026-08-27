import assert from "node:assert/strict";
import test from "node:test";

import { configuredMessagingChannels, messagingReadiness } from "../src/lib/integrations/messaging-readiness";

const completeTwilioConfig = {
  EMAIL_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "secret",
  TWILIO_SMS_FROM: "+27110000000",
  TWILIO_WHATSAPP_FROM: "+14155238886",
  TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID: "HX123",
};

test("messaging is connected only when every configured channel has successful evidence", () => {
  const configured = configuredMessagingChannels(completeTwilioConfig);
  assert.deepEqual([...configured], ["Email", "SMS", "WhatsApp"]);
  assert.equal(messagingReadiness(configured, new Set(["Email", "SMS", "WhatsApp"])).state, "Connected");
});

test("complete configuration without evidence is ready to test, never partial", () => {
  const readiness = messagingReadiness(configuredMessagingChannels(completeTwilioConfig), new Set());
  assert.equal(readiness.state, "Ready to test");
  assert.match(readiness.detail, /Email, SMS, WhatsApp/);
});

test("missing channels are reported as configuration required", () => {
  const configured = configuredMessagingChannels({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "key", EMAIL_FROM: "Stor24 <hello@stor24.co.za>" });
  const readiness = messagingReadiness(configured, new Set(["Email"]));
  assert.equal(readiness.state, "Configuration required");
  assert.equal(readiness.detail, "Configure SMS, WhatsApp");
});
