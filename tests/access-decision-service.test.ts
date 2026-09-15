import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  AccessGovernanceError,
  beginProviderAttempt,
  confirmAccessDecision,
  failAccessDecision,
  isDisplayableAsActive,
  requestAccessDecision,
  type AccessDecisionRecord,
  type AccessDecisionStatePatch,
  type AccessDecisionStore,
} from "../src/lib/access-decision-service";

function createInMemoryStore(): AccessDecisionStore & { all: () => AccessDecisionRecord[] } {
  const records = new Map<string, AccessDecisionRecord>();
  let counter = 0;
  return {
    async findById(id) {
      return records.get(id) ?? null;
    },
    async findByCorrelationId(correlationId) {
      return [...records.values()].find((record) => record.correlationId === correlationId) ?? null;
    },
    async findLatestForOccupancy(occupancyId) {
      const matches = [...records.values()].filter((record) => record.occupancyId === occupancyId);
      return matches.length ? matches[matches.length - 1] : null;
    },
    async create(input) {
      counter += 1;
      const record: AccessDecisionRecord = {
        id: `decision-${counter}`,
        organisationId: input.organisationId,
        facilityId: input.facilityId,
        occupancyId: input.occupancyId,
        action: input.action,
        source: input.source,
        reason: input.reason,
        requestedById: input.requestedById,
        correlationId: input.correlationId,
        state: "DESIRED",
        attempts: 0,
        failureCode: null,
        failureMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      records.set(record.id, record);
      return record;
    },
    async updateState(id, patch: AccessDecisionStatePatch) {
      const existing = records.get(id);
      if (!existing) throw new Error("NOT_FOUND");
      const updated: AccessDecisionRecord = {
        ...existing,
        state: patch.state,
        attempts: patch.attempts ?? existing.attempts,
        failureCode: patch.failureCode === undefined ? existing.failureCode : patch.failureCode,
        failureMessage: patch.failureMessage === undefined ? existing.failureMessage : patch.failureMessage,
        updatedAt: new Date(),
      };
      records.set(id, updated);
      return updated;
    },
    all() {
      return [...records.values()];
    },
  };
}

function baseInput(overrides: Partial<Parameters<typeof requestAccessDecision>[1]> = {}) {
  return {
    organisationId: "org-1",
    facilityId: "facility-1",
    occupancyId: "occupancy-1",
    action: "ACTIVATE" as const,
    source: "STOR24_BILLING" as const,
    reason: "Monthly rent paid",
    correlationId: randomUUID(),
    ...overrides,
  };
}

test("MEL cannot request ACTIVATE, RESTORE or REVOKE", async () => {
  const store = createInMemoryStore();
  await assert.rejects(
    requestAccessDecision(store, baseInput({ source: "MEL_REQUEST", action: "ACTIVATE", correlationId: randomUUID() })),
    (error: unknown) => error instanceof AccessGovernanceError && error.code === "MEL_CANNOT_GRANT_ACCESS",
  );
  await assert.rejects(
    requestAccessDecision(store, baseInput({ source: "MEL_REQUEST", action: "RESTORE", correlationId: randomUUID() })),
    (error: unknown) => error instanceof AccessGovernanceError && error.code === "MEL_CANNOT_GRANT_ACCESS",
  );
  await assert.rejects(
    requestAccessDecision(store, baseInput({ source: "MEL_REQUEST", action: "REVOKE", correlationId: randomUUID() })),
    (error: unknown) => error instanceof AccessGovernanceError && error.code === "MEL_CANNOT_REVOKE_ACCESS",
  );
  // A MEL-sourced SUSPEND signal is allowed through as a request STOR24 can review.
  const suspend = await requestAccessDecision(store, baseInput({ source: "MEL_REQUEST", action: "SUSPEND", correlationId: randomUUID() }));
  assert.equal(suspend.state, "DESIRED");
});

test("a merchandise-only purchase cannot activate or restore access", async () => {
  const store = createInMemoryStore();
  await assert.rejects(
    requestAccessDecision(store, baseInput({ isMerchandiseOnly: true })),
    (error: unknown) => error instanceof AccessGovernanceError && error.code === "MERCHANDISE_CANNOT_GRANT_ACCESS",
  );
});

test("an R10/test payment cannot activate or restore access", async () => {
  const store = createInMemoryStore();
  await assert.rejects(
    requestAccessDecision(store, baseInput({ isTestPayment: true })),
    (error: unknown) => error instanceof AccessGovernanceError && error.code === "TEST_PAYMENT_CANNOT_GRANT_ACCESS",
  );
});

test("SUSPEND is never gated by the merchandise/test-payment guard", async () => {
  const store = createInMemoryStore();
  const decision = await requestAccessDecision(store, baseInput({ action: "SUSPEND", isMerchandiseOnly: true, isTestPayment: true, correlationId: randomUUID() }));
  assert.equal(decision.state, "DESIRED");
});

test("a repeated correlationId is idempotent and does not duplicate or re-run guards", async () => {
  const store = createInMemoryStore();
  const key = randomUUID();
  const first = await requestAccessDecision(store, baseInput({ correlationId: key }));
  const second = await requestAccessDecision(store, baseInput({ correlationId: key, isTestPayment: true }));
  assert.equal(first.id, second.id);
  assert.equal(store.all().filter((record) => record.correlationId === key).length, 1);
});

test("a later decision for the same occupancy flags an in-flight one for reconciliation instead of dropping it", async () => {
  const store = createInMemoryStore();
  const first = await requestAccessDecision(store, baseInput({ correlationId: randomUUID() }));
  await beginProviderAttempt(store, first.id);
  const second = await requestAccessDecision(store, baseInput({ action: "SUSPEND", correlationId: randomUUID() }));
  const refreshedFirst = await store.findById(first.id);
  assert.equal(refreshedFirst?.state, "RECONCILIATION_REQUIRED");
  assert.equal(second.state, "DESIRED");
});

test("state machine only allows DESIRED/FAILED -> PENDING -> CONFIRMED|FAILED, never skipping to CONFIRMED", async () => {
  const store = createInMemoryStore();
  const decision = await requestAccessDecision(store, baseInput({ correlationId: randomUUID() }));
  await assert.rejects(confirmAccessDecision(store, decision.id), (error: unknown) => error instanceof AccessGovernanceError && error.code === "INVALID_STATE_TRANSITION");

  const pending = await beginProviderAttempt(store, decision.id);
  assert.equal(pending.state, "PENDING");
  assert.equal(pending.attempts, 1);

  const confirmed = await confirmAccessDecision(store, decision.id);
  assert.equal(confirmed.state, "CONFIRMED");
  assert.equal(isDisplayableAsActive(confirmed), true);

  // Cannot fail an already-confirmed decision.
  await assert.rejects(failAccessDecision(store, decision.id, "X", "y"), (error: unknown) => error instanceof AccessGovernanceError && error.code === "INVALID_STATE_TRANSITION");
});

test("a failed provider attempt is never displayable as active and can be retried", async () => {
  const store = createInMemoryStore();
  const decision = await requestAccessDecision(store, baseInput({ correlationId: randomUUID() }));
  await beginProviderAttempt(store, decision.id);
  const failed = await failAccessDecision(store, decision.id, "HIKCENTRAL_ERROR", "timeout");
  assert.equal(failed.state, "FAILED");
  assert.equal(isDisplayableAsActive(failed), false);

  const retried = await beginProviderAttempt(store, decision.id);
  assert.equal(retried.state, "PENDING");
  assert.equal(retried.attempts, 2);
});

test("PENDING and DESIRED states are never displayable as active", () => {
  assert.equal(isDisplayableAsActive({ state: "DESIRED", action: "ACTIVATE" }), false);
  assert.equal(isDisplayableAsActive({ state: "PENDING", action: "ACTIVATE" }), false);
  assert.equal(isDisplayableAsActive({ state: "RECONCILIATION_REQUIRED", action: "ACTIVATE" }), false);
  assert.equal(isDisplayableAsActive({ state: "CONFIRMED", action: "SUSPEND" }), false);
});
