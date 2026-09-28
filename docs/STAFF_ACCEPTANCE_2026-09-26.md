# STOR24 staff acceptance — 26 September 2026

Technical delivery is recorded separately from business acceptance. No programme priority is accepted by this checklist. All 14 acceptance gates remain open. Use approved synthetic records and authorised staff roles; do not change live operational switches or deliberately cause production failures.

## Verified baseline at 26 September

Latest functional release: PR329, source `9384c2f5dcbad15f43b6c4eedeeb6841ece5285c`, merge `13330163b2599fd3a2c36441188a866edf793dd4`. Required CI36257243525, SQL36257243478 and security36257243449 passed. Main CI36257578447 and deployment36257859001 passed. Exact image `stor24-crm:13330163b` was healthy with service/database readiness at 17:08:31.671 UTC. The suite has 479 passing unit tests plus required database and browser checks. Browser fixtures use synthetic data and do not establish branded production or staff acceptance.

Exact earlier release evidence remains in PROJECT_CONTEXT.md and Excel E066–E088. The spreadsheet records 21 delivered components. Its delivered-component section distinguishes Built, Tested, Merged and Deployed from Pending staff acceptance. Older dated checkpoint notes describe their state at that time.

## Additional builds for review — 28 September

PR331–343 are deployed; exact evidence is recorded in PROJECT_CONTEXT.md and Excel E091–E103. PR344 inventory read recovery is also deployed: exact b83fae9e3 healthy, service/database verified08:04:56.342UTC; Excel E104. These additions do not accept any programme priority.

| Check | Safe acceptance action / evidence | Releases |
|---|---|---|
| Reservation cancellation and inventory removal | Review isolated real-database audit failure/rollback and valid retry evidence. Owner, history and facility restrictions must still reject prohibited removal. Do not remove production units or types to test this. | PR331–333 |
| Migration preflight | Run an authorised export copy through preflight. Review required links, facility relationships, CSV structure, unique business keys and source hashes/counts. Keep source files unchanged. Passing preflight does not prove import, target reconciliation or finance totals. | PR334–337,340 |
| Merchandise supply | On approved synthetic orders, verify queue, permission guidance, one confirmed supply and read-only recovery after an uncertain response. Compare fulfilment and stock evidence. Do not supply a real order for testing. | PR338–339 |
| Reservations | On approved synthetic records, verify create, cancel, extend and expire confirmations, retained rejected inputs and unit-release versus protected-hold messages. Uncertain outcomes require status review before any further write. | PR341–343 |
| Inventory refresh | Confirm initial units and closed-floor labels. Review the supplied desktop/mobile synthetic failure evidence: a successful save remains confirmed when refresh fails, Refresh inventory only reads, and denied reads hide records with administrator/sign-in guidance. No production fault injection or floor switching required. | PR344; E104 |
| Inventory create/edit | On approved synthetic records, create and edit a unit and a unit type. Confirm saved values and matching audit. Review isolated rejection and uncertain-response evidence: entries remain after rejection; uncertain results disable Save even after closing/reopening and require GET-only review. Check the wrapped mobile action controls. | PR345; E105; exact dce9b93d9 healthy08:37:20.215UTC |
| Inventory removal recovery | Review isolated unit/type/owner-cleanup evidence: restrictions remain visible, uncertain results block repeats across GET review, and only the documented removal confirmation produces success. A following read failure must retain the removal confirmation. Do not remove production inventory for acceptance. | PR346; E106; exact3265e6f61 healthy09:05:39.52UTC |

| Renumber preview recovery | Review synthetic preview evidence: entered numbers survive failed previews; mismatched results cannot enable Apply; denial clears inventory; Close and Preview remain reachable on mobile. Do not apply changes to live unit numbers for this check. | PR347; E107; exact6220df339 healthy09:35:28.502UTC |

For each accepted staff check record reviewer, date, synthetic record reference and observed result in the existing tracker. Browser fixtures and automated checks are evidence to review, not a substitute for staff acceptance. Unit create/edit recovery is covered by PR345; removal recovery is covered by PR346; preview recovery is covered by PR347; rate/reset and renumber apply/undo confirmation recovery remain separate work.

## Review in this order

| Check | Staff action and expected evidence | Delivered releases / Excel |
|---|---|---|
| Restricted access | Confirm a restricted manager sees administrator/sign-in guidance; denied reload must not retain private customer or account records. Check allowed facilities separately. | PR314,318; E073,E077 |
| Customer records | Create/edit an approved synthetic customer. Reload and verify identity, contacts and consent. Review one matching audit for each confirmed edit. Invalid resulting names remain rejected. | PR319,320; E078,E079 |
| Leasing edits | Edit an approved synthetic lead, unit type, facility and reservation. Confirm saved values and audit. Non-operational floors must still reject reservation edits; restricted facility authority must still be enforced. Do not enable live booking to test. | PR321–324; E080–E083 |
| Unit and map | Rename a permitted synthetic unit; confirm its map label and audit before/after values. Check an ordinary edit. Linked occupancy/reservation and prohibited status changes must remain protected. | PR325; E084 |
| Unused customer deletion | Review isolated rollback, one-audit retry and existing tenancy/reservation protection. Do not delete live customers for acceptance; retention approval remains separate. | PR327; E086 |
| Facility deactivation | Review isolated rollback and organisation-wide permission evidence. Do not deactivate a live facility for testing. | PR328; E087 |
| Lead deletion | Review isolated failure rollback, one-audit retry and foreign-facility rejection. Do not delete live leads for testing. | PR329; E088 |
| Stock | Review isolated eight-request keyed replay and reserved-stock race evidence. Reconcile approved test movements against physical/source records before inventory acceptance. A new independent key or legacy keyless request is not covered by replay protection. | PR307,308; E066,E067 |
| Daily close | With an approved test facility, enter source totals and attestations, then review the immutable saved snapshot, variance, notes and attribution. This is manual attestation, not bank/provider reconciliation or a posting lock. | PR310,311; E069,E070 |
| Reports | Compare a permitted synthetic export with source data. Check export/view permission intersection, both SAST date boundaries, current-snapshot labels and approved-terms ageing. Quarantined/missing-term amounts must remain distinguishable from zero. | PR312,313,315–317; E071,E072,E074–E076 |
| Failure recovery | Review supplied isolated rejection, timeout and lost-response evidence. Rejected input remains available; uncertain saves require read-only review without automatic replay. Check guidance on a phone. Do not inject faults into production. | PR314,318,319 and prior recovery releases |
| Complete journey | Rehearse booking → identity review → signed agreement → verified payment → approved access photo/provider arrangement → handover → active tenancy → move-out. Compare documents, balances, unit/stock availability and audit against approved sources. | Priority 1 remains open |

## What the automated evidence proves

PR320–325 exercise generic leasing PATCH audit failures with synthetic persistence and real PostgreSQL constraints: the edited record must remain unchanged when its audit insert fails, then a valid retry must create the expected audit. Unit rename includes map-label rollback. PR327–329 add isolated unused-customer deletion, facility-deactivation and lead-deletion rollback/retry evidence. This does not establish request replay protection, concurrent business validation, every create/delete route, or permission changes during an in-flight request.

Reuse the required connected synthetic journey and backup/restore suites. An isolated restore does not prove production key recovery, recovery timings or alert delivery.

## Sign-off remains separate

Record reviewer, date, test record references, expected/actual result and remaining defects in the existing tracker. Leave failed or untested checks open. Outstanding gates include staff/UAT and training; legal/PAIA/biometric basis and retention; provider/device entry, suspension, restoration and removal; finance opening/source balances and approved terms; Netcash/MRI acceptance; billing schedule credentials; Google credential ownership/rotation; production backup/key recovery and alerts; physical stock; offline two-device acceptance; and launch approval. Healthy deployment and zero scanner alerts do not certify GAPP/CIA compliance.
