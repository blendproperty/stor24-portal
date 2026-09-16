# Facial access padding fix, PR #132/#133 deploy confirmation, and Move-In gap explanation — 16 September 2026

This note captures evidence from a session on 16 September 2026 that should be folded into `PROJECT_CONTEXT.md`'s dated evidence log on the next safe full-file edit (the file is currently too large to safely rewrite via this environment's GitHub API tooling in one shot — see `AGENTS.md`/working rule 6).

## PR #132 (missing MEL/HikCentral migration) — confirmed merged and deployed

`prisma/migrations/20260916050000_mel_identity_links_and_access_decisions/migration.sql` was pushed via `codex/mel-integration-missing-migration`. PR #132 passed CI (`mergeable_state: clean`). The `merge_pull_request` tool call was denied by this environment's auto-mode safety classifier ("[Production Deploy]"); Brett merged it himself. Confirmed on `main` at commit `5b15a03` ("fix: add missing migration for MEL identity link and access decision tables (#132)"), merged 2026-09-16T05:16:43Z.

## PR #133 (Facial access card padding) — confirmed merged, deployed and live-verified

Root cause: `.panel` in `src/app/globals.css` intentionally carries zero padding; internal spacing requires the separate `.panel-spacious` modifier (22px). Three `<section>` elements were missing it: "Biometric access register" and the two `MelIntegrationStatus` sections ("MEL identity links", "Access decisions"). Fixed via two `className="panel panel-spacious"` edits in `src/components/biometric-access-workspace.tsx` and `src/components/mel-integration-status.tsx`, pushed on `codex/access-panel-padding`.

CI passed; `merge_pull_request` was again denied by the classifier ("[Merge Without Review]"); Brett merged it himself. Confirmed merged via `pull_request_read` (`merged: true`, `merged_by: blendproperty`, `merged_at: 2026-09-16T05:51:26Z`) and on `main` at commit `b473741`. Live-verified afterward with Claude in Chrome: zoomed screenshots of all three cards on the production `/access` page show correct 22px padding, matching "Enrol a tenant".

**Note for future sessions:** `merge_pull_request` is reliably denied by this environment's classifier for this repository — always hand the PR link to Brett to merge rather than retrying or working around it, and expect a real deploy lag of roughly a minute or more after merge before the running container reflects it (a screenshot taken in that window can look unchanged even though the merge succeeded).

## "Enrol a tenant" empty-dropdown report — investigated and explained, not a defect

Brett reported (with screenshots, escalating to frustration) that the "Active tenancy" dropdown on Facial access shows no selectable customers. Investigation via `read_page` confirmed the live `<select>` renders only its own disabled placeholder option — genuinely zero candidates, not a rendering bug.

Root cause traced through `src/app/access/page.tsx`: candidates come from `db.occupancy.findMany({ where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, ... } })`, i.e. only real, moved-in tenancies. The `/tenants` page confirms this system-wide: **Active tenants: 0** (alongside Customers: 42, Reservations: 7, Leads: 42). The `/audit` log shows many `public_reservation.*` → `public_lease.signed` → `public_payment.netcash_sandbox_started` sequences (9–16 September) but no `tenancy.activated`/`occupancy.created` event anywhere in the fetched window.

This matches the design already documented in `PROJECT_CONTEXT.md` under "Lease-before-payment controlled workflow" and "Reservation agreement PDF and pre-signing payment choice": the public reservation/lease-signing/payment flow deliberately does **not** activate a tenancy, occupy a unit, or grant access — a separate staff action is required.

Confirmed directly on the live Tenants page: Brett Dovey's own record has a signed booking agreement (Store 1 - Midpoint, Unit 265, CARD, signed 2026/09/15 14:33:37) but "Tenancies and units" reads *"No tenancy yet. Use Move In when the customer selects a unit."*, and a dedicated **Move in** button exists on `/tenants` next to Add customer. Nobody has completed a Move In for any of the current signed reservations.

This is expected behaviour given the documented design, not a UI defect — the Facial access dropdown is correctly refusing to show tenants who have not been moved in yet. No code change was made for this investigation. Recommended next step for Brett: use the Move In flow on `/tenants` for a signed reservation (e.g. his own Unit 265 booking) to prove the dropdown populates once a real occupancy exists.
