# STOR24 staff acceptance — 26 September 2026

Technical delivery is recorded separately from business acceptance. No programme priority is accepted by this checklist. All 14 acceptance gates remain open. Use approved synthetic records and authorised staff roles; do not change live operational switches or deliberately cause production failures.

## Verified baseline

Latest functional release: PR325, source `2c414ebd4161e71472885a2bbc08ed213add040e`, merge `2782b1706ee3b5e63b8abe261e275a2be80cae86`. Required CI36252902887, SQL36252902919 and security36252902862 passed. Main CI36253221870 and deployment36253531807 passed. Exact image `stor24-crm:2782b1706` was healthy with service/database readiness at 15:56:34.578 UTC. The suite has 476 passing unit tests plus required database and browser checks. Browser fixtures use synthetic data and do not establish branded production or staff acceptance.

Exact earlier release evidence remains in PROJECT_CONTEXT.md and Excel E066–E084. The spreadsheet's delivered-component section distinguishes Built, Tested, Merged and Deployed from Pending staff acceptance. Older dated checkpoint notes describe their state at that time.

## Review in this order

| Check | Staff action and expected evidence | Delivered releases / Excel |
|---|---|---|
| Restricted access | Confirm a restricted manager sees administrator/sign-in guidance; denied reload must not retain private customer or account records. Check allowed facilities separately. | PR314,318; E073,E077 |
| Customer records | Create/edit an approved synthetic customer. Reload and verify identity, contacts and consent. Review one matching audit for each confirmed edit. Invalid resulting names remain rejected. | PR319,320; E078,E079 |
| Leasing edits | Edit an approved synthetic lead, unit type, facility and reservation. Confirm saved values and audit. Non-operational floors must still reject reservation edits; restricted facility authority must still be enforced. Do not enable live booking to test. | PR321–324; E080–E083 |
| Unit and map | Rename a permitted synthetic unit; confirm its map label and audit before/after values. Check an ordinary edit. Linked occupancy/reservation and prohibited status changes must remain protected. | PR325; E084 |
| Stock | Review isolated eight-request keyed replay and reserved-stock race evidence. Reconcile approved test movements against physical/source records before inventory acceptance. A new independent key or legacy keyless request is not covered by replay protection. | PR307,308; E066,E067 |
| Daily close | With an approved test facility, enter source totals and attestations, then review the immutable saved snapshot, variance, notes and attribution. This is manual attestation, not bank/provider reconciliation or a posting lock. | PR310,311; E069,E070 |
| Reports | Compare a permitted synthetic export with source data. Check export/view permission intersection, both SAST date boundaries, current-snapshot labels and approved-terms ageing. Quarantined/missing-term amounts must remain distinguishable from zero. | PR312,313,315–317; E071,E072,E074–E076 |
| Failure recovery | Review supplied isolated rejection, timeout and lost-response evidence. Rejected input remains available; uncertain saves require read-only review without automatic replay. Check guidance on a phone. Do not inject faults into production. | PR314,318,319 and prior recovery releases |
| Complete journey | Rehearse booking → identity review → signed agreement → verified payment → approved access photo/provider arrangement → handover → active tenancy → move-out. Compare documents, balances, unit/stock availability and audit against approved sources. | Priority 1 remains open |

## What the automated evidence proves

PR320–325 exercise generic leasing PATCH audit failures with synthetic persistence and real PostgreSQL constraints: the edited record must remain unchanged when its audit insert fails, then a valid retry must create the expected audit. Unit rename includes map-label rollback. This does not establish request replay protection, concurrent business validation, every create/delete route, or permission changes during an in-flight request.

Reuse the required connected synthetic journey and backup/restore suites. An isolated restore does not prove production key recovery, recovery timings or alert delivery.

## Sign-off remains separate

Record reviewer, date, test record references, expected/actual result and remaining defects in the existing tracker. Leave failed or untested checks open. Outstanding gates include staff/UAT and training; legal/PAIA/biometric basis and retention; provider/device entry, suspension, restoration and removal; finance opening/source balances and approved terms; Netcash/MRI acceptance; billing schedule credentials; Google credential ownership/rotation; production backup/key recovery and alerts; physical stock; offline two-device acceptance; and launch approval. Healthy deployment and zero scanner alerts do not certify GAPP/CIA compliance.
