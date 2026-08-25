import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/v1/communications/test-whatsapp/route.ts", "utf8");
const page = readFileSync("src/app/communications/page.tsx", "utf8");
const workflow = readFileSync(".github/workflows/configure-twilio-whatsapp.yml", "utf8");

test("WhatsApp connection test is owner-only, same-origin, rate-limited and privacy-safe", () => {
  assert.match(route, /requireOwner\(\)/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /rateLimit\(`test-whatsapp:/);
  assert.match(route, /SOUTH_AFRICAN_E164/);
  assert.match(route, /privacyHash\(recipient\)/);
  assert.doesNotMatch(route, /after:\s*\{[\s\S]*?recipient[,:]/);
  assert.match(route, /communication\.whatsapp\.test_succeeded/);
  assert.match(route, /communication\.whatsapp\.test_failed/);
  assert.match(route, /TWILIO_WHATSAPP_TEST_CONTENT_SID/);
  assert.match(route, /sendTemplate/);
});

test("communications page exposes the test only when the sender is configured", () => {
  assert.match(page, /TWILIO_WHATSAPP_FROM/);
  assert.match(page, /TWILIO_WHATSAPP_TEST_CONTENT_SID/);
  assert.match(page, /session\?\.role === "Organisation owner"/);
  assert.match(page, /<WhatsAppTestForm \/>/);
});

test("configuration workflow keeps the WhatsApp sender server-side", () => {
  assert.match(workflow, /secrets\.TWILIO_WHATSAPP_FROM/);
  assert.match(workflow, /secrets\.TWILIO_WHATSAPP_TEST_CONTENT_SID/);
  assert.match(workflow, /grep -v -E.*TWILIO_WHATSAPP_FROM/);
  assert.doesNotMatch(workflow, /echo.*TWILIO_WHATSAPP_FROM/);
});
