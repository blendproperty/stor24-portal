import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyBlendSignLease } from "../src/lib/blendsign-reconciliation";
import { BLENDSIGN_REMINDER_COOLDOWN_MS, blendSignReminderRequestId } from "../src/lib/blendsign-client";

const now = new Date("2026-08-24T08:00:00.000Z");
const base = { status: "SENT", externalId: "env-1", createdAt: new Date("2026-08-24T07:00:00.000Z"), expiresAt: new Date("2026-08-31T07:00:00.000Z"), tenancyStatus: "DRAFT" };
test("completed signed leases are healthy", () => assert.equal(classifyBlendSignLease({ ...base, status: "SIGNED", tenancyStatus: "ACTIVE" }, now), "COMPLETED"));
test("signed draft tenancies require reconciliation", () => assert.equal(classifyBlendSignLease({ ...base, status: "SIGNED" }, now), "RECONCILIATION_REQUIRED"));
test("active tenancies with unsigned documents require reconciliation", () => assert.equal(classifyBlendSignLease({ ...base, tenancyStatus: "ACTIVE" }, now), "RECONCILIATION_REQUIRED"));
test("recent pending documents are still dispatching", () => assert.equal(classifyBlendSignLease({ ...base, status: "PENDING", externalId: null, createdAt: new Date("2026-08-24T07:58:00.000Z") }, now), "DISPATCHING"));
test("old pending documents without an envelope failed dispatch", () => assert.equal(classifyBlendSignLease({ ...base, status: "PENDING", externalId: null }, now), "DISPATCH_FAILED"));
test("expired sent documents are overdue", () => assert.equal(classifyBlendSignLease({ ...base, expiresAt: new Date("2026-08-23T07:00:00.000Z") }, now), "OVERDUE"));
test("unexpired sent documents await signature", () => assert.equal(classifyBlendSignLease(base, now), "AWAITING_SIGNATURE"));
test("every BlendSign exception state has an operator action", () => {
  const page = readFileSync(new URL("../src/app/integrations/page.tsx", import.meta.url), "utf8");
  assert.match(page, /DISPATCH_FAILED[\s\S]*retry-dispatch/);
  assert.match(page, /OVERDUE[\s\S]*resend-invitation/);
  assert.match(page, /RECONCILIATION_REQUIRED[\s\S]*Review account/);
});
test("reminder retries share a stable idempotency key inside the cooldown window", () => {
  const first = new Date("2026-08-31T08:15:01.000Z");
  const repeat = new Date(first.getTime() + 30_000);
  assert.equal(blendSignReminderRequestId("doc-1", first), blendSignReminderRequestId("doc-1", repeat));
  assert.notEqual(blendSignReminderRequestId("doc-1", first), blendSignReminderRequestId("doc-2", first));
  assert.match(blendSignReminderRequestId("doc-1", first), /^REM-[A-F0-9]{24}$/);
});
test("reminder idempotency key rotates after the cooldown window", () => {
  const first = new Date("2026-08-31T08:15:01.000Z");
  const later = new Date(first.getTime() + BLENDSIGN_REMINDER_COOLDOWN_MS);
  assert.notEqual(blendSignReminderRequestId("doc-1", first), blendSignReminderRequestId("doc-1", later));
});
test("resend route enforces a server-side cooldown before provider delivery", () => {
  const route = readFileSync(new URL("../src/app/api/v1/documents/[id]/actions/[action]/route.ts", import.meta.url), "utf8");
  assert.match(route, /BLENDSIGN_REMINDER_COOLDOWN/);
  assert.match(route, /occurredAt:\s*\{\s*gte:/);
  assert.match(route, /status:\s*429/);
  assert.match(route, /blendSignReminderRequestId\(document\.id, now\)/);
});
