import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { isMelIntegrationApproved, MEL_CONTRACT_VERSION, MelIntegrationProvider } from "../src/lib/integrations/mel-provider";

test("no MEL contract is approved yet", () => {
  assert.equal(MEL_CONTRACT_VERSION, null);
  assert.equal(isMelIntegrationApproved(), false);
});

test("health() refuses even when fully configured, because no contract is approved", async () => {
  const provider = new MelIntegrationProvider({ enabled: true, baseUrl: "https://mel.example.test", appKey: "key", appSecret: "secret" });
  const result = await provider.health();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONTRACT_NOT_APPROVED");
    assert.equal(result.retryable, false);
  }
});

test("health() refuses disabled/unconfigured MEL with CONTRACT_NOT_APPROVED, since no contract exists to configure against", async () => {
  const provider = new MelIntegrationProvider({ enabled: false });
  const result = await provider.health();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CONTRACT_NOT_APPROVED");
});

test("syncStatusChange never executes a live status change regardless of configuration", async () => {
  const configured = new MelIntegrationProvider({ enabled: true, baseUrl: "https://mel.example.test", appKey: "key", appSecret: "secret" });
  const result = await configured.syncStatusChange({ melIntegrationLinkId: "link-1", action: "SUSPEND", reason: "non-payment", correlationId: randomUUID() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CONTRACT_NOT_APPROVED");
});

test("syncStatusChange requires a correlation ID before anything else", async () => {
  const provider = new MelIntegrationProvider({ enabled: true, baseUrl: "https://mel.example.test", appKey: "key", appSecret: "secret" });
  const result = await provider.syncStatusChange({ melIntegrationLinkId: "link-1", action: "REACTIVATE", reason: "paid", correlationId: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CORRELATION_ID_REQUIRED");
});

test("registerIdentityLink refuses without a MEL IntegrationLinkID and never executes live", async () => {
  const provider = new MelIntegrationProvider({ enabled: true, baseUrl: "https://mel.example.test", appKey: "key", appSecret: "secret" });
  const missingId = await provider.registerIdentityLink({ organisationId: "org-1", customerId: "cust-1", melIntegrationLinkId: "" });
  assert.equal(missingId.ok, false);
  if (!missingId.ok) assert.equal(missingId.code, "LINK_ID_REQUIRED");

  const result = await provider.registerIdentityLink({ organisationId: "org-1", customerId: "cust-1", melIntegrationLinkId: "MEL-123" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CONTRACT_NOT_APPROVED");
});
