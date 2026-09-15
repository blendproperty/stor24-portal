# MEL / HikCentral Ownership Matrix (proposed, Stage 1)

Status: **PROPOSED — awaiting provider agreement.** Nothing in this document is a
signed contract with MEL or Active Motion/Hikvision. It exists so that (a) engineering
does not build dual-writer behaviour before ownership is settled, and (b) there is a
single, reviewable document to take back to Brendon Whelan (MEL), Camryn, and
Sheldon/Active Motion for confirmation or correction.

Source: Brendon Whelan's 15 September 2026 email, "Re: FINAL: Stor24 / MEL / Hikvision
Integration – Data and Access Flow". That email proposes a functional model; it does
**not** settle who is authoritative for shared fields/actions. Treat every "Proposed
STOR24 authority" column below as STOR24's negotiating position, not an agreed fact,
until Brendon/MEL/Active Motion confirm it in writing.

Until this matrix (or a successor) is formally agreed, no code path may allow MEL to
independently activate, restore, or permanently revoke STOR24-controlled storage
access. `src/lib/access-decision-service.ts` enforces this in code today for the
access-decision types it governs (`assertSourceMayRequestAction`).

## Ownership matrix

| # | Functional area | Business decision authority | System permitted to execute | Data owner / source of truth | Receiving systems | Conflict handling | Provider agreement outstanding? |
|---|---|---|---|---|---|---|---|
| 1 | Customer / account record (name, contact, billing) | STOR24 (commercial relationship owner) | STOR24 | STOR24 `Customer` | MEL (minimum necessary only, per Brendon's email — no sale/marketing use) | MEL never overwrites STOR24 customer data; MEL-side edits (if any) require an explicit sync-back contract not yet defined | **Yes** — retention, export, deletion, processing-role terms unconfirmed |
| 2 | Person creation / identity linking (STOR24 customer ↔ MEL `IntegrationLinkID` ↔ HikCentral person) | Joint — STOR24 originates the STOR24 side, MEL originates the `IntegrationLinkID`, HikCentral remains the physical-access record | STOR24 writes `IntegrationIdentityLink`; MEL only via an approved adapter (`src/lib/integrations/mel-provider.ts`, currently disabled) | STOR24 `IntegrationIdentityLink` model is the join record; never matched by name/email/mobile alone per Brendon's email | HikCentral (via existing `hikcentral-provider.ts`), proposed MEL adapter | Duplicate/ambiguous matches go to `DUPLICATE_SUSPECTED` and require audited manual resolution (`resolvedById`, `resolutionNotes`) — never auto-merged | **Yes** — MEL's exact `IntegrationLinkID` issuance/lookup contract is unconfirmed |
| 3 | Tenancy / occupancy, including multi-unit and multi-facility | STOR24 | STOR24 | STOR24 `Tenancy` / `Occupancy` | MEL (read-only status signal), HikCentral (door/person mapping) | One customer's identity link is shared across all of that customer's occupancies; ending one tenancy must not be inferred to remove access still justified by another active tenancy | No — this is existing STOR24-owned data; MEL involvement here is a signal, not a decision |
| 4 | Facility / door / access-group permissions | STOR24 (commercial + security policy) | STOR24-triggered HikCentral calls only (existing `hikcentral-provider.ts`) | STOR24 `IntegrationConnection` HikCentral facility mapping | HikCentral | MEL must not independently grant or expand door/access-group permissions | **Yes** — MEL's proposed role in "access groups" per Brendon's email needs an explicit boundary statement |
| 5 | Commercial suspension / reactivation (non-payment, payment resumed) | STOR24 (billing/account authority) | STOR24 (`AccessDecision` with `source: STOR24_BILLING`) | STOR24 `AccessDecision` | HikCentral (via provider call once wired), MEL (status signal only) | Failed payment must not automatically suspend; successful payment must not automatically restore if another restriction exists (see item 6). MEL cannot request `ACTIVATE`/`RESTORE` (`assertSourceMayRequestAction`) | **Yes** — grace periods, payment-arrangement rules, manual override rules need approval |
| 6 | Non-commercial / security restriction (misconduct, safety, legal hold) | STOR24 (facility manager / security escalation) | STOR24 (`AccessDecision` with `source: STOR24_SECURITY`) | STOR24 `AccessDecision` | HikCentral, MEL (status signal only) | A security restriction is never overridden by a payment event or by MEL; only STOR24 can lift it | No — this is a STOR24-internal escalation path; MEL is a downstream signal recipient only |
| 7 | Facial enrolment / biometric updates | STOR24 (existing consent + enrolment flow: `src/lib/biometric-access-service.ts`) | STOR24 → HikCentral only, via existing `enrollBiometricAccess`/`revokeBiometricAccess` | STOR24 `BiometricEnrollment` (SHA-256 image hash only; no raw image stored) | HikCentral | MEL must not duplicate facial data or run a parallel enrolment workflow unless a separately agreed, scoped facial-image sync requirement exists | **Yes** — consent/retention/deletion/audit responsibilities for any MEL-side facial data are unconfirmed, and no such sync exists or is planned in this codebase |
| 8 | End-of-tenancy handling | STOR24 | STOR24 | STOR24 `Tenancy`/`Occupancy`/`AccessDecision` | HikCentral (revoke door permission), MEL (status signal) | Ending a tenancy revokes only the access tied to that occupancy; other active occupancies for the same customer are unaffected (see item 3) | No |
| 9 | Permanent deletion (person record, biometric data) | STOR24 (privacy/data-retention authority), subject to POPIA obligations still being defined for this integration | STOR24-triggered only | STOR24 audit trail + provider confirmation | HikCentral, MEL (if MEL independently holds any linked data — TBD) | A revoke/permission-removal action is explicitly distinct from permanent deletion of a person/biometric record; the existing `revokeBiometricAccess()` only removes HikCentral door permissions today — it does **not** delete the HikCentral person or biometric record, and this must not be described as deletion | **Yes** — no deletion workflow exists yet on either side; POPIA responsibility split is unconfirmed |
| 10 | Access events / audit history | STOR24 (system of record for all access decisions via `AccessDecision` + `AuditEvent`) | STOR24 records every decision and provider confirmation; HikCentral/MEL are sources of raw events, not owners of the STOR24 audit trail | STOR24 `AuditEvent`, `AccessDecision` | Internal only (staff-facing workspace) | Conflicting reports (e.g. HikCentral says confirmed, MEL says something else) surface as `RECONCILIATION_REQUIRED`, never silently reconciled in either party's favour | No — this is STOR24-internal, though the audit trail depends on receiving accurate provider confirmations |

## Non-negotiable boundary (STOR24's position, to be put to MEL/Active Motion for agreement)

1. STOR24 remains authoritative for storage entitlement and commercial access restrictions.
2. MEL must not independently override a STOR24 suspension or grant storage access STOR24 has not authorised.
3. Identity matching is only ever via the persistent `IntegrationLinkID` mapping (`IntegrationIdentityLink`); never name, email, or mobile number alone.
4. A revoke action (permission removal) and a deletion action (person/biometric record removal) are always distinct and audited separately.
5. No live MEL-initiated access-granting call may be enabled until this matrix (or its agreed successor) is signed off and the MEL adapter's contract is confirmed (see `docs/MEL_PROVIDER_HANDOVER.md`).

## What already exists in code vs. what does not

- **Exists today, STOR24 → HikCentral only:** `src/lib/integrations/hikcentral-provider.ts` (enroll/revoke/health), `src/lib/biometric-access-service.ts` (consent, enrolment, revoke), `src/lib/integrations/hikcentral-configuration.ts` (credentials/mapping), `src/lib/integrations/integration-secret-vault.ts` (encrypted secrets).
- **Added by this change, not yet wired into the live enroll/revoke flow:** `src/lib/access-decision-service.ts` (desired/pending/confirmed/failed state machine with the guard rules above), `src/lib/integrations/mel-provider.ts` (draft adapter shape, permanently refuses live calls until `MEL_CONTRACT_VERSION` is set), the `IntegrationIdentityLink` and `AccessDecision` Prisma models.
- **Does not exist and must not be assumed:** any live MEL endpoint, credential, or payload contract; any MEL-initiated access change; any facial-data sync to MEL; any deletion workflow for HikCentral person/biometric records.
