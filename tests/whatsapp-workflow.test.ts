import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { publicReservationSchema } from "../src/lib/public-booking-contract";
import { validTwilioSignature } from "../src/lib/twilio-webhooks";
import { hasWhatsAppConsent, whatsAppAutomationEnabled } from "../src/lib/whatsapp";

test("WhatsApp requires a distinct active consent flag", () => {
  assert.equal(hasWhatsAppConsent({ sms: true, phone: true }), false);
  assert.equal(hasWhatsAppConsent({ whatsapp: true }), true);
  assert.equal(hasWhatsAppConsent({ whatsapp: true, optedOutAt: "2026-08-25T10:00:00.000Z" }), false);
});

test("public reservations preserve explicit WhatsApp consent", () => {
  const parsed = publicReservationSchema.parse({ facilitySlug: "midpoint", unitId: "unit-1", firstName: "Test", lastName: "Customer", email: "test@example.com", phone: "+27817088120", communicationConsent: { whatsapp: true }, idempotencyKey: "1234567890abcdef" });
  assert.equal(parsed.communicationConsent.whatsapp, true);
  assert.equal(parsed.communicationConsent.sms, false);
});

test("reservation WhatsApp start-date variable uses intended move-in, not hold expiry", () => {
  const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
  assert.match(notifications, /"4": input\.variables\.intendedMoveIn/);
  assert.doesNotMatch(notifications, /"4": input\.variables\.holdExpiresAt/);
});

test("viewing WhatsApp includes the 24-hour expiry before the reference", () => {
  const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
  assert.match(notifications, /messageType: "VIEWING_BOOKED"[\s\S]*?"5": input\.variables\.holdExpiresAt, "6": input\.variables\.reference/);
});

test("automation is fail-closed unless explicitly enabled", () => {
  const before = process.env.WHATSAPP_AUTOMATION_ENABLED;
  delete process.env.WHATSAPP_AUTOMATION_ENABLED;
  assert.equal(whatsAppAutomationEnabled(), false);
  process.env.WHATSAPP_AUTOMATION_ENABLED = "true";
  assert.equal(whatsAppAutomationEnabled(), true);
  if (before === undefined) delete process.env.WHATSAPP_AUTOMATION_ENABLED; else process.env.WHATSAPP_AUTOMATION_ENABLED = before;
});

test("Twilio form webhooks require the exact signed production URL and all parameters", () => {
  const tokenBefore = process.env.TWILIO_AUTH_TOKEN;
  const appBefore = process.env.APP_URL;
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
  process.env.APP_URL = "https://stor24.example";
  const entries = [["MessageSid", "SM123"], ["MessageStatus", "delivered"]] as const;
  const source = "https://stor24.example/api/webhooks/twilio/statusMessageSidSM123MessageStatusdelivered";
  const signature = createHmac("sha1", "test_auth_token").update(source).digest("base64");
  const request = new Request("https://internal/api/webhooks/twilio/status", { method: "POST", headers: { "x-twilio-signature": signature } });
  assert.equal(validTwilioSignature(request, entries, "/api/webhooks/twilio/status"), true);
  assert.equal(validTwilioSignature(request, [...entries, ["ErrorCode", "30003"]], "/api/webhooks/twilio/status"), false);
  if (tokenBefore === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = tokenBefore;
  if (appBefore === undefined) delete process.env.APP_URL; else process.env.APP_URL = appBefore;
});
