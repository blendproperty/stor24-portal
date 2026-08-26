import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTwilioRecipient } from "../src/lib/integrations/twilio-provider";

test("Twilio recipients normalize South African local mobile numbers", () => {
  assert.equal(normalizeTwilioRecipient("0817088120"), "+27817088120");
  assert.equal(normalizeTwilioRecipient("081 708 8120"), "+27817088120");
  assert.equal(normalizeTwilioRecipient("27817088120"), "+27817088120");
  assert.equal(normalizeTwilioRecipient("+27817088120"), "+27817088120");
});

test("Twilio recipients reject malformed values before calling the provider", () => {
  assert.equal(normalizeTwilioRecipient("08170"), null);
  assert.equal(normalizeTwilioRecipient("not-a-phone"), null);
});
