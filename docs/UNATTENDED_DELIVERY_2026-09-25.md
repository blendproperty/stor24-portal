# STOR24 settings, finance and security delivery — 25 September 2026

Brett authorised continued unattended technical work. This record covers settings/move-out, finance validation and staff authentication safeguards. All 14 programme priorities remain open for acceptance.

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

## Finance and authentication continuation

The following releases add technical safeguards. They do not close any of the 14 programme acceptance gates.

| Change | Validation | Verified release |
|---|---|---|
| Refund policy validation | Malformed policy and sub-cent limits fail closed; 448 tests and real PostgreSQL preview/request/payout no-write and recovery cases | PR277, source da035fb8faddf1606fc11ce959bf4e1c7ea89733, merge ece54015ff760588ee77ed8459b626359ade49c4; CI 36101447086, SQL 36101447112, security 36101447067, main CI 36101670554 and deploy 36101819511 passed; image ece54015f healthy at 06:14:29 UTC |
| Move-out amount precision | API and direct service reject sub-cent charges/deposits before reads or side effects; 451 tests and PostgreSQL journey checks | PR278, source 54afc8d302832adbe870f2fc7ee934a87c57101f, merge 0509b3a730d68da7eab101c57244ddffe9078a25; CI 36101838036, SQL 36101838002, security 36101838033, main CI 36102072048 and deploy 36102239690 passed; image 0509b3a73 healthy at 06:20:01 UTC |
| Atomic shared attempt limits | Original controlled burst admitted 40 against cap five; fixed helper passes actual PostgreSQL creation/expiry/near-full/concurrent checks; 453 tests | PR279, source cc12e49246e7de0abe444213a8817e0e12c58742, merge 66b84a800d3090b14ba6bca37a88091ad6348f33; CI 36102287929, SQL 36102287948, security 36102288053, main CI 36102529567 and deploy 36102677514 attempt 2 passed; image 66b84a800 healthy at 06:30:04 UTC |
| One-time MFA recovery and atomic credential lifecycle | Original controlled route admitted eight uses of one code; actual routes and PostgreSQL races/audit rollback pass; 454 tests | PR280, source b681789ce099bfd78a1155a8acaff5c99a516d03, merge 0ac8ff5efa4e213552809f2a35d9d00ef644d580; CI 36102963297, SQL 36102963354, security 36102963325, main CI 36103182819 and deploy 36103352276 passed; image 0ac8ff5ef healthy at 06:35:10 UTC |
| Bounded SSH connection retries | YAML and OpenSSH options validated; strict host verification retained, remote deployment never replayed automatically | PR281, source e5845a45af775ec960d59d5bc6ab327dd4d05621, merge 19a99300e0f8b90497c0dcd7be8db816967c077a; CI 36103316363, SQL 36103316464, security 36103316343, main CI 36103523840 and deploy 36103686351 passed; image 19a99300e healthy at 06:39:13 UTC |
| Pending MFA sign-in revocation | Actual signed old challenge now rejects after password/session revocation; reset/change and both database lock orders pass; 456 tests | PR282, source 21516644a790267f761fb3e1c3273cace4bea692, merge 07e127321d5ca24ec8ac0a64aa4e940f826704ba; CI 36103808790, SQL 36103808780, security 36103808699, main CI 36104017729 and deploy 36104200680 passed; image 07e127321 healthy at 08:55:42 UTC |
| Stale password-change rejection | A newer reset cannot be overwritten by an older authenticated request; actual PostgreSQL overlap, single winner and audit rollback/retry pass; 457 tests | PR283, source 58cd77f82e30b928d629a578cce305aa6ddcd3ac, merge d7c9584ff7df862b7aaf61bfecd7bbbc4b751003; CI 36115649368, SQL 36115649325, security 36115649350, main CI 36115874995 and deploy 36116091113 passed; image d7c9584ff healthy at 09:05:41 UTC |
| Password form failure recovery | Actual form passes network/timeout/malformed/uncertain/revoked/validation/success cases at 1440/390/320px without repeated writes, page errors or overflow | PR284, source e8c937756306432351aa4b8c94e626aef69a5591, merge c762b960bb003ab62247b56ca71ee9b7b3dbfbd5; CI 36116066976, SQL 36116066943, security 36116066870, main CI 36116342003 and deploy 36116567808 passed; image c762b960b healthy at 09:07:58 UTC |
| Local-only sign-in return destination | Actual password/MFA/setup component rejects external, backslash, control-character and normalized double-slash forms; local query/hash paths and failed-auth no-navigation pass; 458 tests | PR285, source f3f752b2813486d420230868b00684e3fb9e72db, merge 0778701b29dbbdb2ca1d6bbecdcd2889073341f6; CI 36116601578, SQL 36116601559, security 36116601595, main CI 36116854984 and deploy 36117066667 attempt 2 passed; image 0778701b2 healthy at 09:15:47 UTC |

Every image check above also verified public service/database readiness. No real password, payment, customer balance, move-out, customer message or gate/photo/training/provider switch was used as a test.

### Staff acceptance to perform later

Use a designated synthetic staff/customer account and approved testing arrangements. These remain unchecked:

- [ ] **Normal sign-in:** password plus authenticator works; intended local page opens; ordinary access restrictions still apply.
- [ ] **Recovery code:** one unused code succeeds once; reuse fails; a different unused code remains usable. Keep recovery codes private.
- [ ] **Password change:** wrong current password gives clear feedback; a valid change ends existing sessions and requires the new password plus MFA.
- [ ] **Pending sign-in:** start MFA sign-in in one browser, then reset/change the test account password elsewhere; the old pending challenge must require a fresh sign-in.
- [ ] **Mobile recovery:** review the supplied automated network-loss/timeout evidence and confirm the sign-in guidance is understandable. Do not deliberately fault production; an unknown result must not claim success or automatically repeat a credential change.
- [ ] **Finance/move-out:** review synthetic malformed-refund and sub-cent rejection evidence, then perform the previously listed accepted-policy journey. Confirm documents, balances, unit status and audit against approved source data.
- [ ] **Return links:** local return path works after password and MFA sign-in. Automated tests cover crafted external destinations without visiting an external website.

### Evidence limitations and remaining work

GitHub readback at 09:07 UTC reported zero open Dependabot, code-scanning and secret-scanning alerts. This is not proof of zero vulnerabilities or historical Google credential rotation. Anonymous account/configuration/MFA APIs returned 401 and privacy/PAIA pages returned 200 after rollout stabilised. During container replacement, initial probes briefly returned 502/404 and then recovered; zero-downtime rollout is not proven and remains an availability improvement.

PR285 deployment attempt 1 exhausted its three SSH connection attempts before remote execution. Attempt 2 succeeded; the prior verified image stayed healthy while waiting. Bounded retries reduce transient failures but do not establish the root cause or eliminate runner-to-server connection failures.

The expired two-hour heartbeat is paused. A usage-limit interruption stopped work before Brett's later CARRY ON; this record does not count the intervening scheduled wakeups as implementation time. Latest continuation is actively authorised, without inventing a new unattended deadline.

Legal/PAIA/biometric basis and retention, external provider/device deletion and access, Google ownership/rotation, staff/MFA UAT, approved opening balances and tax/rent rules, MRI/Netcash evidence, billing schedule credential correction, production backup/key recovery targets and delivered alerts remain open. Repeated TOTP policy and existing reset/change transaction-conflict handling are separate from the repaired boundaries.

## Afternoon regression and account-security recovery

PR287 source e61d00783c207d346023ad741d3cd0cc0926bdc5 passed CI 36137656573, PostgreSQL 36137656583 and security 36137656539, and merged aa475cc36a95fd0ce36620bd619505ef20eb12e3. Main CI 36138808482 passed; deployment 36139032611 passed. Exact image stor24-crm:aa475cc36 healthy at 13:10 UTC. Workbook E046 records this release; staff acceptance remains open.

The account-security screen now recovers from failed reads, bounds mutation requests and prevents silent retries after uncertain results. Existing credential/session policies are unchanged. Actual-component browser fixtures cover initial read retry, interrupted/malformed/timeout responses, validation recovery and successful setup at desktop/mobile widths. Staff acceptance remains open.

Fresh baseline: 458 tests, typecheck, lint with existing warnings and production build passed. Synthetic browser checks additionally passed monthly billing, company settings, six-step move-in, password recovery, local sign-in return links, restricted navigation, payment retries, debit orders, adjustments/refunds, collections, settlements and MRI. These do not prove real provider delivery, finance reconciliation or staff acceptance.

## Afternoon operations checkpoint — 14:55 UTC

PR289/290 portal pending/completed purchase read recovery and PR291 task status/audit atomicity are deployed; exact promotion evidence is retained in PROJECT_CONTEXT.md and Excel E048–E050. PR292 stock movement transaction/concurrency protection is deployed; expanded regression found a historical-negative-stock receipt edge case, corrected in PR293 rather than silently treating PR292 as complete coverage.

PR293 source3cc322c65ef41c6fa82a7fe1b69bc879c949653a merged d7ac92e3f509d28329a67222bfcc5d39d86d9525. CI36147684921/SQL36147684901/security36147684864 and mainCI36148138323/deploy36148432411 passed; exact imaged7ac92e3f healthy/service/database verified14:36:50 UTC. Task, unit-note, product and package creation now rolls back if audit creation fails, including nested package items; the receipt correction preserves the original non-negative result rule.

PR294 source6506c975f29f3036e11825da361b1cf56db9b4db merged14c7c7c7ed7a390a65d7b4d7aa4e78f0ade161e4. CI36149214934/SQL36149214953/security36149214704 and mainCI36150205019/deploy36150494999 passed. Exact image14c7c7c7e healthy/service/database verified14:55:33 UTC. Task completion validates confirmation and requires a read-only status check after an uncertain result. All462 unit tests passed; actual-component desktop/mobile failure and recovery fixtures passed. Workbook E052/E053 records these releases; zero programme priorities accepted.

### Staff acceptance still required

- [ ] With an authorised synthetic task, confirm Complete removes the task from the open queue and creates one audit entry.
- [ ] Review the supplied rejected/lost-response browser evidence: an uncertain completion must offer Check task status and must not repeat a change automatically. Do not deliberately fault production.
- [ ] Review isolated PostgreSQL stock evidence: competing deductions cannot oversell current quantity, audit failure rolls back the movement, and a receipt against negative stock must restore a non-negative quantity. Reserved-stock policy and cross-request idempotency remain separate.
- [ ] Review task/note/product/package rollback evidence and then verify permitted creation and audit history using approved test records. No production transactions were created by these rehearsals.
- [ ] Confirm portal purchase and pending-order recovery guidance is understandable on a phone; provider payment and financial acceptance remain open.

The next candidate addresses false empty operations/merchandise screens after failed initial reads. It is not yet deployed at this checkpoint. Other mutation forms and the original legal/provider/finance/recovery gates remain open.



## Inventory and operations recovery checkpoint — 16:44 UTC

PR295–301 are deployed. Operations reads no longer present failed retrieval as an empty queue; denied reads remove displayed records and explain sign-in or administrator access. Task and maintenance creation/status forms recover from failed confirmations. Manual stock and product creation retain rejected input, guard duplicate clicks and require read-only review after uncertain outcomes. Exact source, required checks, merge, deployment and live evidence is retained in PROJECT_CONTEXT.md and Excel E054–E060.

Latest PR301 source d4829fbb54eb1fb4c8c8efd0c08ac76ceacd0109 merged9f06205978d0760cd0ea5275b2ba992159d14643 after CI36161617061/SQL36161617070/security36161617181 passed. Main CI36162080052/deploy36162451490 passed. Image stor24-crm:9f0620597 healthy, service/database verified16:44:33.239 UTC. All462 unit tests/typecheck/focused lint passed, plus actual-component recovery fixtures at1440/390/320px. Fixtures use synthetic data and omit the production font/shell; they do not establish staff or financial acceptance.

- [ ] As a restricted manager, confirm denied operations/merchandise access explains contacting the administrator and does not retain previously displayed records.
- [ ] Using approved test records, create and complete a task; create and progress maintenance; verify correct unit availability and audit history.
- [ ] Review lost-response evidence: forms must retain rejected input and uncertain outcomes must require reading current records rather than silently repeating a change. Do not deliberately fault production.
- [ ] With approved inventory test records, check signed stock movements and product opening quantity against audit history. Confirm mobile guidance is understandable.
- [ ] Product update and package create/update failure recovery remain separate pending work. Stock reservation policy and server cross-request idempotency remain open.

No real payments, customer messages, production balance/stock changes or operational switches were used in these rehearsals. All14 programme acceptance gates remain open; legal, provider, finance, Google ownership/rotation, recovery and staff approvals are unchanged. Excel export/reimport and independent XML checks pass, with the known native exit-after-export limitation. New PR links remain recorded despite the app's100-attachment cap.

## Afternoon final acceptance handoff — 17:43 UTC

PR303–305 product edit, package create and package edit recovery are deployed. Latest sourcee663e50f90d5f4aacb2032fba326a1e2cc35c672 mergedf2c5b9865afa91ac8fda7800c750ea084eb202ae after CI36167728811/SQL36167728801/security36167728717 passed. MainCI36168320591/deploy36168748677 passed; exact image stor24-crm:f2c5b98 healthy/service/database verified17:43:22.345 UTC. All462 unit tests/typecheck/lint and desktop/mobile synthetic recovery tests passed. Earlier “pending” statements above describe their checkpoint time, not current release state.

Complete these with Brett or the facility manager before acceptance:

1. Review permission behaviour as a restricted manager: unavailable sections give administrator/sign-in guidance and do not retain stale displayed records after denial.
2. Use approved synthetic inventory records to create/edit a product and create/edit a package. Confirm name, SKU/code, price, active status, contents/quantities and audit history; existing booking snapshots must remain unchanged.
3. Review the supplied network-loss/rejection evidence. Rejected inputs stay available; uncertain saves require catalogue review without automatic replay. Check the recovery guidance on a phone. Do not inject production faults.
4. Rehearse one approved task and maintenance request through creation and completion; confirm audit and unit availability, then an approved daily close against source totals.
5. Finish the customer journey with approved identity/agreement/payment/access arrangements, active tenancy and move-out; reconcile documents, balances, stock/unit availability and audit. Provider and legal approvals cannot be inferred from these technical tests.

Every programme priority remains open for acceptance. The finance/source-data, legal/biometric, provider/device, Google rotation, billing schedule credential and production recovery/alert gates listed earlier remain unresolved. Automated tests and healthy deployment do not certify GAPP/CIA compliance. Read-only GitHub checks at approximately17:38 UTC found zero open dependency/code/secret alerts, without proving historical credential rotation.
