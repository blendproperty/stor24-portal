/**
 * Central, provider-independent access-decision service.
 *
 * This module intentionally knows nothing about HikCentral, MEL, or any other
 * provider — it exists to separate "what STOR24 has decided access should be"
 * (this file) from "what a provider was actually told and confirmed" (provider
 * adapters such as src/lib/integrations/hikcentral-provider.ts and the draft
 * src/lib/integrations/mel-provider.ts). This is Stage 3/5 groundwork for the
 * MEL integration (see docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md and
 * docs/MEL_PROVIDER_HANDOVER.md); it is additive and is NOT yet wired into the
 * live enroll/revoke paths in src/lib/biometric-access-service.ts. Wiring it in
 * is deliberately left as follow-up work requiring its own review, so this PR
 * cannot destabilise the already-verified HikCentral enroll/revoke flow.
 *
 * Guard rules enforced here (see docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md for the
 * rationale and the outstanding provider-agreement status of each):
 *   - MEL cannot request ACTIVATE or RESTORE, and cannot REVOKE. STOR24 is the
 *     sole authority for granting/restoring/permanently revoking storage access
 *     until a provider agreement says otherwise. A MEL-sourced SUSPEND request
 *     is allowed through as a signal for STOR24-side review.
 *   - A merchandise-only purchase must never drive ACTIVATE/RESTORE.
 *   - A test payment (e.g. R10 UAT) must never drive ACTIVATE/RESTORE.
 *   - A decision only reaches CONFIRMED after a real provider execution attempt.
 *     UI code must render "active"/"restored"/"synced" only when a decision's
 *     state is CONFIRMED — never from DESIRED or PENDING alone.
 */

export type AccessDecisionAction = "ACTIVATE" | "SUSPEND" | "RESTORE" | "REVOKE";

/**
 * Where the request to change access originated. MEL_REQUEST is included so the
 * guard rules below have something concrete to test against even though no live
 * MEL adapter exists yet (see src/lib/integrations/mel-provider.ts).
 */
export type AccessDecisionSource = "STOR24_BILLING" | "STOR24_MANUAL" | "STOR24_SECURITY" | "MEL_REQUEST";

export type AccessDecisionState = "DESIRED" | "PENDING" | "CONFIRMED" | "FAILED" | "RECONCILIATION_REQUIRED";

export type AccessDecisionRecord = {
  id: string;
  organisationId: string;
  facilityId: string;
  occupancyId: string;
  action: AccessDecisionAction;
  source: AccessDecisionSource;
  reason: string;
  requestedById: string | null;
  correlationId: string;
  state: AccessDecisionState;
  attempts: number;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RequestAccessDecisionInput = {
  organisationId: string;
  facilityId: string;
  occupancyId: string;
  action: AccessDecisionAction;
  source: AccessDecisionSource;
  reason: string;
  requestedById?: string | null;
  correlationId: string;
  /** True when the triggering event was a merchandise-only order/payment. */
  isMerchandiseOnly?: boolean;
  /** True when the triggering payment was a test (e.g. R10 UAT) payment. */
  isTestPayment?: boolean;
};

export type AccessDecisionStatePatch = {
  state: AccessDecisionState;
  attempts?: number;
  failureCode?: string | null;
  failureMessage?: string | null;
};

export interface AccessDecisionStore {
  findById(id: string): Promise<AccessDecisionRecord | null>;
  findByCorrelationId(correlationId: string): Promise<AccessDecisionRecord | null>;
  findLatestForOccupancy(occupancyId: string): Promise<AccessDecisionRecord | null>;
  create(record: {
    organisationId: string;
    facilityId: string;
    occupancyId: string;
    action: AccessDecisionAction;
    source: AccessDecisionSource;
    reason: string;
    requestedById: string | null;
    correlationId: string;
  }): Promise<AccessDecisionRecord>;
  updateState(id: string, patch: AccessDecisionStatePatch): Promise<AccessDecisionRecord>;
}

export class AccessGovernanceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AccessGovernanceError";
  }
}

/**
 * MEL is not yet an approved writer for any access-granting action. This must
 * stay true even after a live MEL adapter exists, until a signed provider
 * agreement explicitly changes STOR24's authority boundary (see the ownership
 * matrix doc). SUSPEND from MEL is allowed through as a signal for a human/
 * STOR24-side review, never REVOKE (destructive) or ACTIVATE/RESTORE (grants).
 */
export function assertSourceMayRequestAction(source: AccessDecisionSource, action: AccessDecisionAction): void {
  if (source !== "MEL_REQUEST") return;
  if (action === "ACTIVATE" || action === "RESTORE") {
    throw new AccessGovernanceError(
      "MEL_CANNOT_GRANT_ACCESS",
      "MEL is not authorised to activate or restore storage access. STOR24 is the sole authority for granting access until a provider agreement says otherwise.",
    );
  }
  if (action === "REVOKE") {
    throw new AccessGovernanceError(
      "MEL_CANNOT_REVOKE_ACCESS",
      "MEL is not authorised to permanently revoke storage access. Only STOR24-sourced decisions may do so.",
    );
  }
}

export function assertPaymentMayDriveActivation(input: { action: AccessDecisionAction; isMerchandiseOnly?: boolean; isTestPayment?: boolean }): void {
  if (input.action !== "ACTIVATE" && input.action !== "RESTORE") return;
  if (input.isMerchandiseOnly) {
    throw new AccessGovernanceError("MERCHANDISE_CANNOT_GRANT_ACCESS", "A merchandise-only purchase must not activate or restore storage access.");
  }
  if (input.isTestPayment) {
    throw new AccessGovernanceError("TEST_PAYMENT_CANNOT_GRANT_ACCESS", "A test payment (e.g. an R10 UAT transaction) must never grant or restore storage access.");
  }
}

/**
 * Idempotent: a repeated request with the same correlationId returns the
 * existing decision rather than creating a duplicate or re-running the guards.
 */
export async function requestAccessDecision(store: AccessDecisionStore, input: RequestAccessDecisionInput): Promise<AccessDecisionRecord> {
  const existing = await store.findByCorrelationId(input.correlationId);
  if (existing) return existing;

  assertSourceMayRequestAction(input.source, input.action);
  assertPaymentMayDriveActivation(input);

  const previous = await store.findLatestForOccupancy(input.occupancyId);
  if (previous && (previous.state === "DESIRED" || previous.state === "PENDING")) {
    // A newer decision supersedes an in-flight one for the same occupancy; the
    // in-flight one is flagged rather than silently dropped, so an operator can
    // see it was superseded instead of assuming it quietly succeeded or failed.
    await store.updateState(previous.id, { state: "RECONCILIATION_REQUIRED" });
  }

  return store.create({
    organisationId: input.organisationId,
    facilityId: input.facilityId,
    occupancyId: input.occupancyId,
    action: input.action,
    source: input.source,
    reason: input.reason,
    requestedById: input.requestedById ?? null,
    correlationId: input.correlationId,
  });
}

async function requireDecision(store: AccessDecisionStore, decisionId: string): Promise<AccessDecisionRecord> {
  const decision = await store.findById(decisionId);
  if (!decision) throw new AccessGovernanceError("DECISION_NOT_FOUND", `Access decision ${decisionId} was not found.`);
  return decision;
}

function requireState(decision: AccessDecisionRecord, expected: AccessDecisionState, transition: string) {
  if (decision.state !== expected) {
    throw new AccessGovernanceError(
      "INVALID_STATE_TRANSITION",
      `Cannot ${transition}: decision ${decision.id} is in state ${decision.state}, expected ${expected}.`,
    );
  }
}

/** Marks that a provider call is about to be attempted. DESIRED or FAILED -> PENDING only. */
export async function beginProviderAttempt(store: AccessDecisionStore, decisionId: string): Promise<AccessDecisionRecord> {
  const decision = await requireDecision(store, decisionId);
  if (decision.state !== "DESIRED" && decision.state !== "FAILED") {
    throw new AccessGovernanceError("INVALID_STATE_TRANSITION", `Cannot begin a provider attempt: decision ${decisionId} is in state ${decision.state}.`);
  }
  return store.updateState(decisionId, { state: "PENDING", attempts: decision.attempts + 1 });
}

/** Provider confirmed the change. PENDING -> CONFIRMED only. */
export async function confirmAccessDecision(store: AccessDecisionStore, decisionId: string): Promise<AccessDecisionRecord> {
  const decision = await requireDecision(store, decisionId);
  requireState(decision, "PENDING", "confirm");
  return store.updateState(decisionId, { state: "CONFIRMED", failureCode: null, failureMessage: null });
}

/** Provider execution failed. PENDING -> FAILED only; failure must never be reported as success. */
export async function failAccessDecision(store: AccessDecisionStore, decisionId: string, code: string, message: string): Promise<AccessDecisionRecord> {
  const decision = await requireDecision(store, decisionId);
  requireState(decision, "PENDING", "fail");
  return store.updateState(decisionId, { state: "FAILED", failureCode: code, failureMessage: message });
}

/** A decision may only be displayed to staff/tenants as "active" once CONFIRMED. */
export function isDisplayableAsActive(decision: Pick<AccessDecisionRecord, "state" | "action">): boolean {
  return decision.state === "CONFIRMED" && (decision.action === "ACTIVATE" || decision.action === "RESTORE");
}
