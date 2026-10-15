import test from "node:test";
import assert from "node:assert/strict";
import { staffEmailCommand, staffEmailInput, staffEmailSastTime } from "../src/lib/staff-event-email-policy";

const input = { facilityId: "cm00000000000000000000001", label: "Midpoint staff review", recipientIds: ["cm00000000000000000000002"], kinds: ["BOOKING"], from: "2026-10-15", to: "2026-10-15", notBefore: "2026-10-15T09:00", expires: "2026-10-16T00:00" };
test("staff email policy requires explicit recipients, store, events and complete SAST date windows", () => {
  assert.ok(staffEmailInput.safeParse(input).success);
  assert.equal(staffEmailSastTime(input.notBefore).toISOString(), "2026-10-15T07:00:00.000Z");
  for (const changed of [{ recipientIds: [] }, { recipientIds: [...input.recipientIds, ...input.recipientIds] }, { kinds: [] }, { facilityId: "" }, { to: "2026-10-14" }, { to: "2026-11-17" }, { expires: "2026-10-15T23:59" }, { expires: "2026-10-16T24:00" }, { expires: "2026-02-30T00:00" }, { notBefore: "2026-10-15T25:00" }, { recipientIds: ["manager@example.invalid"] }, { enabled: true }]) assert.equal(staffEmailInput.safeParse({ ...input, ...changed }).success, false, JSON.stringify(changed));
});
test("only the dedicated strict workflow commands are accepted; activation and direct sends are not client commands", () => {
  assert.ok(staffEmailCommand.safeParse({ action: "preview", input, requestKey: "c3a695c2-cb0f-439e-979d-32c1e41381cc" }).success);
  for (const action of ["send", "activate", "dispatch", "retry"]) assert.equal(staffEmailCommand.safeParse({ action, input }).success, false);
  assert.equal(staffEmailCommand.safeParse({ action: "prepare", input, requestKey: "c3a695c2-cb0f-439e-979d-32c1e41381cc", expectedFingerprint: "a".repeat(64), recipient: "external@example.invalid" }).success, false);
});
