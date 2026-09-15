import type { ProviderResult } from "@/lib/integrations/providers";

/**
 * MEL ("My Estate Life") integration adapter — DRAFT / PROPOSED CONTRACT ONLY.
 *
 * This file exists to give the STOR24 <-> MEL boundary a concrete, testable shape
 * ahead of a confirmed provider agreement, per Brendon Whelan's 15 September 2026
 * email ("Re: FINAL: Stor24 / MEL / Hikvision Integration - Data and Access Flow").
 * Nothing in this file talks to a real MEL endpoint, and nothing in it is enabled
 * by default. Do not:
 *   - invent a working MEL base URL, credential shape, endpoint path or payload
 *     convention beyond what is written here as "proposed";
 *   - treat `enabled: true` as authorisation to grant/restore storage access — see
 *     src/lib/access-decision-service.ts, which is the sole authority for that and
 *     which this adapter must never bypass;
 *   - remove the `CONTRACT_NOT_APPROVED` guard in `syncStatusChange` without an
 *     explicit, reviewed provider agreement replacing it.
 *
 * What MEL's email proposes (unconfirmed, recorded here only so the adapter shape
 * matches it): tenant creation/sync, updates, account/status changes, suspension,
 * reactivation, removal and reconciliation via a shared `IntegrationLinkID`, using
 * synchronous, state-aware request/response processing. Actual authentication,
 * endpoints, payloads, responses, error codes and timeouts remain to be finalised
 * with Camryn and MEL's technical team.
 */

export type MelProviderConfiguration = {
  /**
   * Master switch. Even when true, `syncStatusChange` still refuses to execute
   * because no MEL contract version has been approved yet (see CONTRACT_VERSION
   * below). This flag exists so configuration UI/tests can be built now without
   * granting any live capability.
   */
  enabled: boolean;
  baseUrl?: string;
  appKey?: string;
  appSecret?: string;
};

export type MelIdentityLinkInput = {
  organisationId: string;
  customerId: string;
  melIntegrationLinkId: string;
};

export type MelStatusChangeAction = "SUSPEND" | "REACTIVATE" | "REMOVE";

export type MelStatusChangeInput = {
  melIntegrationLinkId: string;
  action: MelStatusChangeAction;
  reason: string;
  /** Required: every provider call must be idempotent and traceable. */
  correlationId: string;
};

/**
 * No MEL contract has been approved. Bumping this is a deliberate, reviewed act
 * that must accompany a real provider agreement (endpoints, auth, payload shapes,
 * error semantics) — never a silent side effect of unrelated code changes.
 */
export const MEL_CONTRACT_VERSION: string | null = null;

function isFullyConfigured(configuration: MelProviderConfiguration): boolean {
  return Boolean(configuration.enabled && configuration.baseUrl && configuration.appKey && configuration.appSecret);
}

export class MelIntegrationProvider {
  readonly category = "MEL_TENANT_SYNC" as const;

  constructor(private readonly configuration: MelProviderConfiguration) {}

  async health(): Promise<ProviderResult<{ latencyMs: number }>> {
    if (!MEL_CONTRACT_VERSION) {
      return { ok: false, retryable: false, code: "CONTRACT_NOT_APPROVED", message: "No MEL provider contract has been approved; the MEL integration remains disabled." };
    }
    if (!isFullyConfigured(this.configuration)) {
      return { ok: false, retryable: false, code: "CONFIG_REQUIRED", message: "MEL has not been configured." };
    }
    return { ok: false, retryable: false, code: "CONTRACT_NOT_APPROVED", message: "MEL connectivity is not implemented pending an approved provider contract." };
  }

  /**
   * Always refuses. Kept as a real method (rather than omitted entirely) so the
   * eventual implementation has an obvious, already-tested seam, and so that
   * callers who wire this in early get a clear, typed refusal rather than a
   * runtime crash from a missing method.
   */
  async syncStatusChange(input: MelStatusChangeInput): Promise<ProviderResult<{ accepted: boolean }>> {
    if (!input.correlationId) {
      return { ok: false, retryable: false, code: "CORRELATION_ID_REQUIRED", message: "A correlation ID is required for every MEL status-change request." };
    }
    if (!MEL_CONTRACT_VERSION || !isFullyConfigured(this.configuration)) {
      return { ok: false, retryable: false, code: "CONTRACT_NOT_APPROVED", message: "MEL cannot be asked to change tenant status until a provider contract is approved and configured." };
    }
    return { ok: false, retryable: false, code: "CONTRACT_NOT_APPROVED", message: "MEL status-change execution is not implemented pending an approved provider contract." };
  }

  /**
   * Register (or update) the organisation-scoped identity link on the MEL side.
   * Same refusal behaviour as above until a contract exists.
   */
  async registerIdentityLink(input: MelIdentityLinkInput): Promise<ProviderResult<{ melIntegrationLinkId: string }>> {
    if (!input.melIntegrationLinkId) {
      return { ok: false, retryable: false, code: "LINK_ID_REQUIRED", message: "A MEL IntegrationLinkID is required." };
    }
    if (!MEL_CONTRACT_VERSION || !isFullyConfigured(this.configuration)) {
      return { ok: false, retryable: false, code: "CONTRACT_NOT_APPROVED", message: "MEL identity-link registration is not available until a provider contract is approved and configured." };
    }
    return { ok: false, retryable: false, code: "CONTRACT_NOT_APPROVED", message: "MEL identity-link registration is not implemented pending an approved provider contract." };
  }
}

export function isMelIntegrationApproved(): boolean {
  return Boolean(MEL_CONTRACT_VERSION);
}
