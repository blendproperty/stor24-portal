import assert from "node:assert/strict";
import test from "node:test";
import { tenantIdentityMessage } from "../src/lib/tenant-identity-presentation";

const now = new Date("2026-09-23T08:00:00Z").getTime();
const uploaded = { status: "AWAITING_REVIEW", acknowledgedAt: "2026-09-23T07:55:00Z", reviewedAt: null, retentionMode: "TENANCY", expiresAt: null };
test("received ID stays pending until staff review and retention never implies acceptance", () => {
  assert.match(tenantIdentityMessage(uploaded, now).title, /uploaded.*pending verification/);
  assert.match(tenantIdentityMessage({ ...uploaded, retentionMode: "FIXED_PERIOD", expiresAt: "2026-09-23T09:00:00Z" }, now).title, /pending verification/);
  for (const expiresAt of [null, "2026-09-23T08:00:00Z", "2026-09-22T08:00:00Z"]) {
    assert.match(tenantIdentityMessage({ ...uploaded, retentionMode: "FIXED_PERIOD", expiresAt }, now).title, /expired/);
  }
  assert.equal(tenantIdentityMessage({ ...uploaded, status: "ACCEPTED", retentionMode: "FIXED_PERIOD", expiresAt: "2026-09-22" }, now).title, "ID verified");
});
test("missing, withdrawn, replacement and unknown ID states do not claim upload success", () => {
  assert.match(tenantIdentityMessage(null, now).title, /No ID upload/);
  assert.match(tenantIdentityMessage({ ...uploaded, status: "WITHDRAWN" }, now).title, /withdrawn/);
  assert.match(tenantIdentityMessage({ ...uploaded, status: "REPLACEMENT_REQUIRED" }, now).title, /Replacement/);
  assert.match(tenantIdentityMessage({ ...uploaded, status: "EXPIRED" }, now).title, /expired/);
  assert.match(tenantIdentityMessage({ ...uploaded, status: "UNKNOWN" }, now).title, /unavailable/);
});
