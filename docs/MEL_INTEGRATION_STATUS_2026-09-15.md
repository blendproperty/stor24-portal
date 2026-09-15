# MEL / HikCentral Integration Status Addendum — 15 September 2026

This is a standalone dated addendum to `PROJECT_CONTEXT.md`, following the
same pattern used for `docs/HIKCENTRAL_FIX_2026-09-15.md` (PR #126): the
canonical `PROJECT_CONTEXT.md` is 231KB and full-file rewrites of it through
this session's tooling have repeatedly failed or corrupted content, so this
session records status here instead of attempting another full rewrite.
**Fold this section into `PROJECT_CONTEXT.md` on the next edit made with a
less constrained tool (e.g. a local editor), then delete this file.**


Scope: Brendon Whelan's 15 September 2026 email ("Re: FINAL: Stor24 / MEL / Hikvision
Integration – Data and Access Flow") asked for the MEL bolt-on integration to
proceed in safe stages, without inventing provider contracts and without allowing
MEL and STOR24 to become dual writers over the same access decisions. This entry
covers Stage 1 (ownership matrix) and part of Stages 2–4 (identity-mapping schema,
provider-independent access-decision state machine, and a disabled draft MEL
adapter) of that brief. Stages 5–7 (wiring status changes into live payment/
biometric flows, extending the operational workspace UI, and the full regression
suite) are explicitly **not** done in this change and remain open — see below.

- **Verification before changing anything:** re-confirmed CRM `main` HEAD was still
  `550ee74605f963f9752a286fe8685babc5a6fe92` (unchanged since the prior HikCentral
  fix session) before branching. Confirmed no MEL-related code existed anywhere in
  `src/lib/integrations/` prior to this change, and that
  `docs/STOR24_OUTSTANDING_TASKS.md` (dated 2 September 2026) predates MEL and does
  not mention it — that register's HikCentral item 2 remains **BLOCKED** exactly as
  written and is unaffected by this change.
- **Implementation:**
  - `docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md` — the Stage 1 ownership matrix across
    the ten functional areas the brief specified (customer records, identity
    linking, tenancy/occupancy, facility/door permissions, commercial suspension/
    reactivation, security restrictions, biometric enrolment, end-of-tenancy,
    permanent deletion, audit history), explicitly labelled proposed/unconfirmed
    pending MEL/Active Motion agreement.
  - `prisma/schema.prisma`: additive `IntegrationIdentityLink` model (one row per
    customer, organisation-scoped, mapping STOR24 customer ↔ proposed MEL
    `IntegrationLinkID` ↔ HikCentral person, with `DUPLICATE_SUSPECTED` /
    `MANUALLY_RESOLVED` states for audited manual reconciliation — never matched by
    name/email/mobile alone) and `AccessDecision` (desired/pending/confirmed/failed/
    reconciliation-required state machine, separate from provider execution). Both
    are purely additive; no existing model, field or migration was changed.
  - `src/lib/access-decision-service.ts`: a new, provider-independent service
    enforcing that MEL cannot request `ACTIVATE`/`RESTORE`/`REVOKE`; that a
    merchandise-only purchase or a test (e.g. R10) payment can never drive
    `ACTIVATE`/`RESTORE`; that a decision is only ever displayable as "active" once
    provider-confirmed (never from `DESIRED`/`PENDING` alone); and that a newer
    decision for the same occupancy flags an older in-flight one for
    reconciliation rather than racing it. **This service is intentionally not yet
    wired into the live `src/lib/biometric-access-service.ts` enroll/revoke flow or
    into payment/merchandise processing** — that flow is unchanged and remains
    exactly as previously verified. Wiring it in is left as explicit follow-up work
    requiring its own review, so this change carries no risk to the only
    HikCentral path currently in production use.
  - `src/lib/integrations/mel-provider.ts`: a draft adapter matching MEL's proposed
    capabilities (tenant sync, status change, identity-link registration), modelled
    on the existing `hikcentral-provider.ts` pattern. Every method refuses to
    execute (`CONTRACT_NOT_APPROVED`) because `MEL_CONTRACT_VERSION` is `null` —
    this is unconditional and does not depend on any enable flag or configuration
    value, so it cannot be accidentally switched on. No live MEL base URL,
    credential shape, endpoint path or payload has been invented.
  - `docs/MEL_PROVIDER_HANDOVER.md`: the outstanding-question list for MEL/Camryn/
    Active Motion, by owner, plus six controlled pilot scenarios (none yet run) and
    the rollback/reconciliation approach.
- **Testing:** `tests/access-decision-service.test.ts` (9 tests) and
  `tests/mel-provider.test.ts` (6 tests) — both pure-logic, in-memory-store tests
  requiring no database, run directly with `tsx --test` in this session: 15/15
  passed. The two new source files were also isolated-type-checked (a scoped
  `tsc --noEmit` covering exactly these files and their direct dependency,
  `providers.ts`, since the full repository `typecheck`/`prisma generate` could not
  run in this environment — its engine-download step is blocked by the sandbox's
  network allowlist, the same limitation already documented under "Working rules
  for any AI assistant" above) and linted (`eslint`) with zero errors. The
  Prisma schema change itself could not be validated with `prisma validate` in
  this environment for the same network-allowlist reason; it was written and
  reviewed by hand against the existing model conventions in the same file
  (naming, `@@index`/`@@unique` patterns, `onDelete` behaviour) and should be
  validated with `npx prisma validate` / `npx prisma generate` in an environment
  with normal network access before merge.
- **Commit and push / merge / deployment:** PR #127 merged to `main`, but a fault in
  this session's GitHub-push tooling silently dropped every file from that PR except
  `prisma/schema.prisma` — the merge commit on `main` (`63a8006`) contains only the
  schema change; `access-decision-service.ts`, `mel-provider.ts`, both test files,
  and all three of these docs never actually reached `main` despite the PR
  description claiming otherwise. This was caught by re-diffing `main` after the
  merge and comparing it against the local commit that was originally pushed. The
  missing files are being restored via a follow-up branch/PR
  (`codex/mel-integration-missing-files`) pushed file-by-file after the bulk-push
  tool was shown to be unreliable for this repository. Treat the original PR #127
  description's "genuinely built and tested" claims as accurate for what the code
  says, but not as proof those files were ever live on `main` until the follow-up
  PR is merged — check `git show origin/main:src/lib/access-decision-service.ts`
  (or the equivalent for each file) rather than trusting the earlier PR merge alone.
- **Outstanding (explicitly not done here, per the brief's own staging and safety
  requirements):**
  1. Wiring `access-decision-service.ts` into the live biometric enroll/revoke and
     payment/merchandise flows (Stage 5), including the specific edge-case
     regression coverage the brief lists (wrong org/facility, out-of-order/
     duplicate events, concurrent suspend/reactivate, provider timeout/retry,
     R10/merchandise not granting access, etc.) — only the pure state-machine
     guards are tested so far, not their integration into real payment/biometric
     code paths.
  2. Extending the existing HikCentral integration/access workspace UI to surface
     identity links, decision state, pending/failed/conflicting changes and a safe
     retry/reconciliation control (Stage 6).
  3. Any real MEL endpoint, credential, authentication, payload or error contract —
     all of Stage 4's live-call surface remains unimplemented by design, pending
     MEL/Camryn's answers in `docs/MEL_PROVIDER_HANDOVER.md`.
  4. HikCentral's own outstanding blockers in `docs/STOR24_OUTSTANDING_TASKS.md`
     item 2 (trusted TLS chain, approved OpenAPI credentials, org/door mapping,
     POPIA boundary) are unchanged by this work and remain BLOCKED.
  5. No provider agreement, ownership-matrix sign-off, legal/POPIA review, or
     external communication with MEL/Active Motion has occurred. No email was
     sent as part of this work.
