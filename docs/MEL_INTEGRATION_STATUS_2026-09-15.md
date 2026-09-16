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
covers Stage 1 (ownership matrix), Stages 2–4 (identity-mapping schema,
provider-independent access-decision state machine, and a disabled draft MEL
adapter), and now Stage 6 (read-only workspace UI). Stage 5 (wiring status
changes into live payment/biometric flows) and Stage 7 (the full regression
suite covering that wiring) are explicitly **not** done in this change and
remain open — see below.

- **Verification before changing anything:** re-confirmed CRM `main` HEAD was
  `aee532257fc504e1ed24b388bb14dc31bc0595c2` (`Netcash test payment now includes
  the merchandise/storage package price`, PR #130) before branching for Stage 6.
  Confirmed via `git diff main FETCH_HEAD --stat` after PR #128 merged that all
  eight files from the original Stage 1–4 slice (`docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md`,
  `docs/MEL_PROVIDER_HANDOVER.md`, this status file, `prisma/schema.prisma`,
  `src/lib/access-decision-service.ts`, `src/lib/integrations/mel-provider.ts`,
  `tests/access-decision-service.test.ts`, `tests/mel-provider.test.ts`) are
  genuinely present on `main`, closing out the silent-drop incident recorded
  below. `docs/STOR24_OUTSTANDING_TASKS.md`'s HikCentral item 2 remains
  **BLOCKED** exactly as written and is unaffected by this change.
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
  - **Stage 6, new this entry:** `src/lib/mel-integration-status-service.ts` adds
    two read-only Prisma queries (`listIdentityLinks`, `listAccessDecisions`),
    organisation/facility-scoped exactly like the existing `listBiometricAccess`.
    `src/app/api/v1/access/mel-status/route.ts` exposes them as a single
    `GET`-only API route behind `requirePermissionScope("access.view")` — there is
    deliberately no `POST`/`PUT`/`DELETE`, since nothing in Stage 6 may create,
    approve or execute a MEL status change or access decision.
    `src/components/mel-integration-status.tsx` renders both as read-only tables
    (`MelIntegrationStatus`), following the existing `BiometricAccessWorkspace`
    conventions (`page-stack`/`panel`/`data-table`/`empty-cell`, `StatusPill` for
    state colouring). `src/app/access/page.tsx` now fetches both lists
    server-side (same pattern as its existing `listBiometricAccess` call) and
    mounts the new panel directly below the existing HikCentral enrolment
    workspace on the same `/access` page — no new navigation entry, no change to
    the existing enrol/revoke form or its API route. Because nothing yet writes an
    `AccessDecision` row and no real MEL identity-linking flow exists, both tables
    are expected to render empty until Stage 5 wiring and a real MEL identity-link
    flow land; the UI states this honestly instead of implying a fault.
- **Testing:** `tests/access-decision-service.test.ts` (9 tests) and
  `tests/mel-provider.test.ts` (6 tests) are unchanged and still pass 15/15
  (pure-logic, in-memory-store tests requiring no database, run directly with
  `tsx --test`). The Stage 6 files cannot be exercised the same way because they
  import the Prisma client (`@/lib/db`) directly, and this environment still
  cannot generate the Prisma client (`prisma generate`'s engine-download step is
  blocked by the sandbox's network allowlist, the same limitation already
  documented under "Working rules for any AI assistant" above) or run the
  database-backed integration suite. In its place: `eslint` passes with zero
  errors on all four new/changed files; a full-repository `tsc --noEmit` run
  was compared before and after the change (246 pre-existing errors on `main`
  without Stage 6, all of the same "Prisma client not generated" shape, versus
  248 with Stage 6 — exactly the two new `.map()` calls added to
  `src/app/access/page.tsx`, the same implicit-any symptom as the two pre-existing
  `.map()` calls already in that file, not a new class of error). No new
  migration is required: this slice only reads the `IntegrationIdentityLink` and
  `AccessDecision` tables already added by the original Stage 1–4 migration.
- **Commit and push / merge / deployment:** PR #127 merged to `main`, but a fault in
  this session's GitHub-push tooling silently dropped every file from that PR except
  `prisma/schema.prisma` — the merge commit on `main` (`63a8006`) contains only the
  schema change; `access-decision-service.ts`, `mel-provider.ts`, both test files,
  and all three of these docs never actually reached `main` despite the PR
  description claiming otherwise. This was caught by re-diffing `main` after the
  merge and comparing it against the local commit that was originally pushed. The
  missing files were restored via PR #128 (`codex/mel-integration-missing-files`),
  pushed file-by-file after the bulk-push tool was shown to be unreliable for this
  repository, and PR #128 has since been merged — `git diff main FETCH_HEAD --stat`
  confirms all eight original files are genuinely on `main`. This Stage 6 slice is
  on branch `codex/mel-integration-stage6-ui`, pushed file-by-file for the same
  reason, and is not yet merged at the time of this entry — see the pull request
  for merge status.
- **Outstanding (explicitly not done here, per the brief's own staging and safety
  requirements):**
  1. Wiring `access-decision-service.ts` into the live biometric enroll/revoke and
     payment/merchandise flows (Stage 5), including the specific edge-case
     regression coverage the brief lists (wrong org/facility, out-of-order/
     duplicate events, concurrent suspend/reactivate, provider timeout/retry,
     R10/merchandise not granting access, etc.) — only the pure state-machine
     guards are tested so far, not their integration into real payment/biometric
     code paths. This is also why the new Stage 6 tables are expected to render
     empty in production today.
  2. A safe retry/reconciliation control for `RECONCILIATION_REQUIRED`/`FAILED`
     access decisions was explicitly out of scope for this Stage 6 slice (it
     would be a write path) and remains open, to be built alongside Stage 5.
  3. Any real MEL endpoint, credential, authentication, payload or error contract —
     all of Stage 4's live-call surface remains unimplemented by design, pending
     MEL/Camryn's answers in `docs/MEL_PROVIDER_HANDOVER.md`.
  4. HikCentral's own outstanding blockers in `docs/STOR24_OUTSTANDING_TASKS.md`
     item 2 (trusted TLS chain, approved OpenAPI credentials, org/door mapping,
     POPIA boundary) are unchanged by this work and remain BLOCKED.
  5. No provider agreement, ownership-matrix sign-off, legal/POPIA review, or
     external communication with MEL/Active Motion has occurred. No email was
     sent as part of this work.
  6. Live/production verification of the Stage 6 screen (an authenticated
     `access.view`-permitted staff member opening `/access` and seeing both new
     tables, correctly empty, with no change to the existing HikCentral
     enrol/revoke behaviour above them) has not been performed and requires this
     branch to be merged and deployed first.
