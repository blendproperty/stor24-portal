import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("WhatsApp automation control is owner-only, audited and database-backed", () => {
  const route = read("src/app/api/v1/integrations/whatsapp-automation/route.ts");
  const service = read("src/lib/integrations/whatsapp-automation.ts");
  assert.match(route, /requireOwner/);
  assert.match(service, /integration\.whatsapp\.automation\.enabled/);
  assert.match(service, /integrationConnection/);
});

test("customer sends require both server gate and organisation toggle", () => {
  const sender = read("src/lib/whatsapp.ts");
  assert.match(sender, /getWhatsAppAutomationState\(input\.organisationId\)/);
  assert.match(sender, /AUTOMATION_DISABLED/);
});

test("verified public holds send their consented confirmation while lifecycle automation stays disabled", () => {
  const booking = read("src/lib/public-booking-service.ts");
  const notifications = read("src/lib/notifications.ts");
  assert.match(booking, /allowWhatsappWhenAutomationDisabled: true/);
  assert.match(notifications, /allowWhenAutomationDisabled: input\.allowWhatsappWhenAutomationDisabled/);
});

test("template configuration exposes a validated UAT safety gate input defaulting closed", () => {
  const workflow = read(".github/workflows/configure-whatsapp-templates.yml");
  assert.match(workflow, /automation_gate/);
  assert.match(workflow, /default: "false"/);
  assert.match(workflow, /WHATSAPP_AUTOMATION_ENABLED=%s/);
  assert.match(workflow, /true\|false/);
});
