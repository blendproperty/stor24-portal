# STOR24 settings delivery — 25 September 2026

Brett authorised continued unattended technical work. This checkpoint advances Priority 7 (P06) and the Priority 1 move-out path. All 14 programme priorities remain open for acceptance.

## Delivered controls

| Change | Automated evidence | Release |
|---|---|---|
| Configuration saves and their audit commit together | Actual-route before/after rollback proof; create/update/recovery for profiles, connectors, charges and discounts; 443 unit tests; real PostgreSQL audit-failure cases | PR273, source f2ac1b9612f28ca96d9fda5c76e65abca1deaf2d, merge 719ae2690bd2a5dd6c9faeab680a9cd0d4f89ff3; CI 36099085097, SQL 36099085107, main CI 36099265786 and deployment 36099424823 passed; exact image healthy/readiness verified 05:41:15 UTC |
| Saved move-out date rules apply before side effects | Actual-service bypass reproduction fixed; 447 tests including South African midnight/date modes, cap/month/leap boundaries, invalid policies and confirmed retries; actual PostgreSQL no-write and complete journey | PR274, source 5427c110fbed895beab63bea520659217766274f, merge 85ce43cada30fc17641e9667ad008fdd74c98d7d; CI 36099483751, SQL 36099483766, main CI 36099728526 and deployment 36099898249 passed; exact image healthy/readiness verified 05:47:45 UTC |
| Setup distinguishes connected controls from planning preferences | Actual component at 1440px and 390px, tab labels, edited values preserved, existing recovery checks, no page errors/overflow; typecheck/lint and required checks passed | PR275, source 076a7d5be4ca9fa51678d1a7295c279faa86350c, merge ffa0485428886465e28dc503a14aa141b6e743dc; CI 36099833284, SQL 36099833457 and security 36099833404 passed; main CI 36100067167 and deployment 36100236103 attempt 2 passed (attempt 1 SSH timeout before execution); exact image ffa048542 healthy/readiness verified at 05:55:50 UTC |

Runtime status is specific to the preferences in this setup screen. Planning-only labels do not mean the entire product has no billing, access or security controls; those workflows retain their dedicated controls.

## Manager acceptance when ready

Use an approved synthetic tenancy and the existing authorised training arrangements. Do not change a live facility's policy merely to run a test.

1. Open Company setup → Program defaults. Verify planning-only labels and the specific connected date/refund/countersigning descriptions. Saving a planning preference must not be mistaken for activating a workflow.
2. In an approved test facility, save the agreed move-out date policy. Attempt a disallowed date: a clear message must appear before access, unit status or account balance changes. Then test an allowed date with all normal move-out prerequisites satisfied.
3. Verify the unit, tenancy, statement and audit after the successful synthetic move-out. Retry the original request after a policy change: the completed result must be reused without a second financial/access action. Changed request details remain a conflict.
4. Review setup failure/recovery: preserved inputs, explicit uncertain-save feedback and refresh of actual saved state. Audit rejection/rollback is exercised in isolated automated database tests, not by inducing a production database fault.

## Outstanding boundaries

- Only explicitly saved READY store move-out date rules are enforced by this release. Unset rules retain previous behaviour. Blank/zero backdating cap means unlimited; invalid saved rules require review.
- Other planning preferences still need individual implementation, business decisions and acceptance. No fee, proration, automated daily-close, provider or access policy was activated.
- No customer messages, real payments, balances, move-outs or operational switches changed during these tests.
- Staff/finance acceptance, legal/PAIA/biometric decisions, provider/device evidence, Google credential ownership/rotation and approved production backup/recovery remain open, as recorded in the prior delivery record.
- The old four-hour automation remains paused. This record does not claim ongoing scheduled work or restart that expired session.