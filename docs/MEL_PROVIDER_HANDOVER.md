# MEL Provider Handover — Outstanding Items (15 September 2026)

This is preparation material for Brendon Whelan (MEL), Camryn, and Sheldon/Active
Motion (HikCentral). It is not a legal or commercial commitment, and no external
email has been sent as part of preparing it. It summarises what STOR24 needs from
MEL/Active Motion before any live integration can be enabled, alongside what STOR24
has built so a reviewer can see the current, real state rather than a description of
intended work.

See also `docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md` for the detailed per-function
ownership proposal this handover assumes.

## 1. What is genuinely built (this change)

- `prisma/schema.prisma`: additive `IntegrationIdentityLink` (organisation-scoped
  STOR24 customer ↔ MEL `IntegrationLinkID` ↔ HikCentral person mapping, one row per
  customer, with `DUPLICATE_SUSPECTED`/`MANUALLY_RESOLVED` states for audited
  reconciliation) and `AccessDecision` (desired/pending/confirmed/failed state
  machine, provider-independent).
- `src/lib/access-decision-service.ts`: pure, DB-store-injected service enforcing:
  MEL cannot request `ACTIVATE`/`RESTORE`/`REVOKE`; a merchandise-only purchase or a
  test payment cannot drive `ACTIVATE`/`RESTORE`; a decision is only displayable as
  "active" once provider-confirmed; a newer decision for the same occupancy flags an
  in-flight older one for reconciliation instead of racing it. Covered by
  `tests/access-decision-service.test.ts` (9 tests, in-memory store, no DB required).
- `src/lib/integrations/mel-provider.ts`: draft adapter shape matching MEL's
  proposed capabilities (tenant sync, status change, identity-link registration).
  Every method refuses to execute — `MEL_CONTRACT_VERSION` is `null` — regardless of
  configuration, until a real contract is agreed and this file is deliberately
  updated. Covered by `tests/mel-provider.test.ts` (6 tests).
- This handover document and the ownership matrix.

## 2. What this change deliberately does NOT do

- It does not wire `access-decision-service.ts` into the live
  `biometric-access-service.ts` enroll/revoke flow. That flow remains exactly as it
  was, verified and unmodified, so this PR cannot destabilise the only
  HikCentral integration path currently in production use. Wiring it in is
  follow-up work requiring its own review and its own UAT.
- It does not call any real MEL endpoint, store any real MEL credential, or grant/
  restore/suspend any real customer's access.
- It does not change `docs/STOR24_OUTSTANDING_TASKS.md` item 2 (Hikvision/HikCentral
  access control), which remains **BLOCKED** for the reasons already recorded there
  (untrusted TLS chain proof status, org/door mapping placeholders, POPIA boundary).
  This MEL work is additive to, not a replacement for, closing that blocker.

## 3. Outstanding questions for MEL / Camryn (by dependency owner)

| # | Question | Owner | Blocks |
|---|---|---|---|
| 1 | Exact `IntegrationLinkID` format, issuance flow (who creates it first — STOR24 or MEL?) and lookup contract | MEL / Camryn | Identity-link registration (`mel-provider.ts: registerIdentityLink`) |
| 2 | Authentication scheme (API key, OAuth, mutual TLS?), base URL(s) per environment, and rate limits | MEL / Camryn | Any live `mel-provider.ts` implementation |
| 3 | Exact request/response payload shape and error/status codes for tenant creation, update, suspend, reactivate, remove, reconcile | MEL / Camryn | `syncStatusChange` implementation |
| 4 | Idempotency contract — does MEL support a client-supplied idempotency/correlation key, and what happens on a duplicate? | MEL / Camryn | Safe retry without duplicate side effects |
| 5 | Timeout and retry expectations from MEL's side (does MEL retry on its own, or does STOR24 own retries?) | MEL / Camryn | Bounded retry policy in the eventual adapter |
| 6 | Confirmation of the ownership matrix in `docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md`, or corrections to it | Brendon Whelan (MEL), Brett Dovey (STOR24) | Whether any MEL-initiated action is ever permitted to affect access |
| 7 | Does MEL intend to hold any customer or biometric data itself, and if so under what retention/consent/export/deletion terms? | MEL / legal | POPIA responsibility split, item 9 in the ownership matrix |
| 8 | HikCentral OpenAPI credentials, trusted TLS chain, and confirmed organisation/door index codes for the pilot facility | Sheldon / Active Motion | Already tracked as BLOCKED in `docs/STOR24_OUTSTANDING_TASKS.md` item 2; unaffected by MEL work but a shared prerequisite for any live pilot that exercises HikCentral |

## 4. Proposed controlled pilot scenarios (not yet run — for agreement first)

All of these use disposable, non-production test identities, exactly as prior
STOR24 UAT has done (see the `docs/STOR24_OUTSTANDING_TASKS.md` and
`PROJECT_CONTEXT.md` precedent for controlled UAT discipline). None of these may run
until items 1–5 above are answered and this repository's `mel-provider.ts` has a
real, reviewed implementation behind a feature flag defaulting to off.

1. **Identity link creation:** create one disposable STOR24 customer + occupancy,
   register an `IntegrationIdentityLink`, and confirm MEL and STOR24 agree on the
   resulting `IntegrationLinkID` without any name/email/mobile-based matching.
2. **STOR24-initiated suspension propagates as a signal:** suspend the disposable
   customer's access via `AccessDecision` (`source: STOR24_BILLING`), and confirm
   MEL receives the status signal without independently deciding to restore it.
3. **MEL-initiated suspend request is accepted as a signal, never auto-applied:**
   simulate a MEL suspend request and confirm it lands as a reviewable STOR24
   decision, not an automatic access change.
4. **MEL-initiated activate/restore request is rejected:** simulate a MEL
   activate/restore request and confirm `assertSourceMayRequestAction` rejects it
   with `MEL_CANNOT_GRANT_ACCESS`, and that this is visible in the audit trail.
5. **Multi-unit customer, single tenancy ends:** with two active occupancies under
   one identity link, end one tenancy and confirm access tied to the other
   occupancy is unaffected.
6. **Duplicate identity detected:** attempt to link a second STOR24 customer to an
   already-linked `IntegrationLinkID`/HikCentral person and confirm it is flagged
   `DUPLICATE_SUSPECTED` for manual, audited resolution rather than silently merged.

## 5. Rollback / reconciliation approach

- The MEL adapter ships disabled (`MEL_CONTRACT_VERSION = null`); enabling it is a
  single, reviewable code change, not a runtime toggle that could be flipped
  accidentally.
- `AccessDecision.state` gives an explicit `RECONCILIATION_REQUIRED` state for any
  decision superseded mid-flight or left ambiguous by a provider response, so
  reconciliation is a query (`state = 'RECONCILIATION_REQUIRED'`), not a guess.
- Because provider execution (HikCentral/MEL calls) is separated from the decision
  record, rolling back a bad deployment of the adapter never rolls back or
  re-interprets STOR24's own decision history — the `AccessDecision` rows are the
  source of truth for what STOR24 intended, independent of whether a given provider
  call succeeded.

## 6. What remains dependent on MEL / Active Motion

Everything in section 3's question list, plus: HikCentral trusted connectivity and
approved org/door mappings (existing, separate blocker), a signed-off ownership
matrix, and a controlled pilot (section 4) before any live MEL-initiated status
change is enabled in production.
