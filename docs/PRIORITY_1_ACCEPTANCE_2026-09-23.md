# Priority 1 acceptance evidence — 23 September 2026

Priority 1 remains **open**. This increment proves a connected, isolated service/database journey and fixes an expiry defect. It does not establish live staff acceptance, genuine payment settlement or actual physical entry. The [delivery checklist](STOR24_DELIVERY_CHECKLIST.md) remains the status register.

## E001: connected journey and hold-expiry repair

Environment: PostgreSQL 16 on localhost, synthetic organisation, units, customer, identity images, signature and staff receipt. The test refuses a non-localhost database or a database name without the `_ci` suffix. SMS/email HTTP calls are intercepted in memory; no messages leave the test. The fixture's `realPaymentConfirmed` flag exercises the staff-receipt path only inside that isolated database and is **not real-money evidence**.

Source: [connected test](../tests/integration/customer-journey.test.ts), [booking expiry](../src/lib/public-booking-service.ts), [agreement workflow](../src/lib/public-lease-workflow.ts). The connected test is now part of the existing transaction CI workflow.

The same booking/customer is carried through:

1. Public booking, contact/email verification and an operational ground-floor hold.
2. Synthetic ID upload, rejection, replacement, both page previews and staff acceptance.
3. Agreement preparation, stale-consent rejection, resumed/concurrent signing and a retained PDF/hash.
4. Unpaid-handover rejection, a synthetic EFT receipt, duplicate submission and duplicate-reference protection.
5. Concurrent staff handover into one tenancy and occupancy, with the same account and signed agreement.
6. Tenant sign-in, one-use code checks, session readback and customer/facility boundaries.
7. Notice, move-out, final charge, statement/balance agreement, idempotent retry, unit release, retained agreement and tenancy-duration ID erasure.

Additional cases cover expiry, package stock, other reservations/maintenance, and signing versus expiry ordering.

### D001: signed booking incorrectly cancelled by original hold deadline

**Reproduced before repair:** after a verified booking had an accepted identity, signed agreement and synthetic cleared staff receipt, setting the original hold deadline in the past and calling `releaseExpiredPublicReservations` changed it from `ACTIVE` to `CANCELLED`. The unit became available and handover failed. The assertion expected `ACTIVE` and received `CANCELLED`. This was a connected-path gap that the existing handover fixtures did not expose.

**Repair:** automatic shopping-hold expiry excludes signed agreements. Signed bookings remain for explicit staff cancellation/reconciliation. Expiry locks the unit and reservation, re-reads current eligibility and package state, releases stock once, retains occupancy/maintenance/other-hold restrictions and records an expiry audit. Agreement preparation and completion share the reservation lock, so a stale preparation cannot overwrite a completed signature and expiry cannot cancel a signing transaction based on stale state. The existing ID, terms, payment, floor and handover guards remain enforced.

**Retest:** connected suite passes 15 reported tests (14 scenarios plus the parent). Signed/paid booking survives its original deadline; unsigned abandonment still releases; two expiry workers release one package once; another hold and open maintenance keep their unit unavailable; competing signing/expiry leaves a consistent signed-active or unsigned-cancelled result. The same repaired booking continues through handover and move-out.

**Historical data:** no cancelled production booking was reopened and no customer balance was changed. Any already-cancelled signed bookings require a separate read-only impact review and case-by-case staff handling. Never automatically reassign a unit that may since have been allocated elsewhere.

## Checklist coverage

“Pass” below means the specified isolated technical check passed. Every overall J acceptance checkbox remains open for its remaining scope and named staff acceptance.

| Cases | Current technical evidence | Remaining acceptance |
|---|---|---|
| J01 | Real booking service, same-request replay, competing selection and closed-floor rejection | Current public browser flow with staff observer |
| J02, J08 | Actual encrypted synthetic upload, replacement version, both page previews and review guards | Authorised staff use and approved production policy |
| J03, J15 | Actual PDF generation/hash, customer/unit/rate snapshot, stale consent and concurrent prepare/sign/replay | Browser signature/resume acceptance and final legal wording approval |
| J04 | Staff receipt, account/ledger consistency and duplicate protection in isolated DB | Real finance reconciliation; P02/P03 remain open |
| J05, J13 | Connected handover and current handover suite cover unpaid/test/short/reversed receipts, unsigned/corrupt PDFs, dates and unavailable units | Staff execution of handover and recovery routes |
| J06 | One active tenancy, original account/document, pending access, tenant sign-in/session readback | My STOR24 documents/status across actual devices |
| J07 | Notice, closure, final charge, replay/conflict, released unit, statement/balance, agreement preservation and ID erasure | Finance-approved final account, refunds and staff move-out acceptance |
| J09 | D001 reproduced/fixed; unsigned expiry, package release, expiry/signing race and maintained restrictions pass | Live behavioural proof on an approved controlled fixture; historic impact review |
| J10, J11 | Current handover/settlement integration suite checks pending/failed/test payment, duplicate/late status, mismatched amount and live-provenance gates | Actual provider failure, retry and settlement acceptance |
| J12 | Contact/email code recovery, consumed code rejection, resumed agreement and scoped tenant session readback | Browser refresh, sign-out/in and two-device recovery |
| J14 | Booking competition/closure and concurrent handover; current floor suite checks stale allocations and close-versus-allocation locking | Actual staff/device acceptance |
| J16 | Same booking/customer/account/unit/document trace; single signing, receipt, handover, notice, move-out and erasure audit records | Staff review of the actual audit presentation and production evidence |
| J17 | Denied facility scope for handover and ID preview; customer-bound tenant session | Full route/role matrix and real staff acceptance |
| J18 | D001 retained with before/after evidence; identity/payment retry paths exercised | Staff-led recovery rehearsal and acceptance |
| J19 | Existing floor service/component evidence remains separate | Controlled live toggle/save/reload has not been performed |
| J20 | Deferred | Real Netcash activation/settlement remains deferred by Brett |
| J21 | Blocked | Policy, installed provider, operator and consenting participant required for actual entry/removal |

## Finance boundary retained

The fixture records a R100 payment followed by a R25 final charge, giving a R75 credit. The ledger, stored balance and generated statement agree. No rent/proration, VAT, deposit refund or billing cut-over policy was invented to make the final balance zero. Approval of the actual initial rent period and charges, monthly billing, final reconciliation and credit/refund handling remains P02. The test does not prove that a real account is financially complete merely because its ledger is internally consistent.

## Test records

- Connected journey: 15 reported tests passed.
- Existing isolated floor, identity and reservation-handover suites: 43 reported tests passed, including provider callback simulations and identity retention guards.
- Local evidence: `output/customer-journey/connected-test.log`, `related-database.log`, `hold-expiry-regression-before.log`, `terms-test.log`, `application-tests.log`, `typecheck.log`, `focused-lint.log` and build/check logs. These are local generated evidence; portable checks and final CI receipts belong to the PR/release record in PROJECT_CONTEXT.md.
- Publication/merge/deployment and exact-head CI results are recorded separately in PROJECT_CONTEXT.md. No test result here substitutes for those stages or staff sign-off.

## Next acceptance step

**Reviewer: Brett**, explicitly assigned on 23 September 2026. The repair is deployed; no staff acceptance result has yet been submitted. Guide Brett through one step at a time and record actual outcomes against J IDs.

1. J01 initial browser check: open the [public booking page](https://stor4.srv938083.hstgr.cloud/book), confirm Ground Floor is selectable and First Floor / Second Floor are grey, labelled Coming soon and cannot be selected. Select an available ground-floor unit and verify the displayed unit/rate. Stop before submitting personal details or creating a reservation. This covers only the visibility/selection part of J01.
2. Agree the controlled test customer and environment before booking submission, identity, signing, receipt or messaging steps. Continue the same traceable journey through J01–J07, recording documents, balances, audit references and observed recovery results. Do not make a real signature/payment or contact a customer merely to obtain a test pass.
3. Review the historical candidates below individually with staff/finance. Keep genuine payment and physical access deferred/blocked until the existing approvals and provider readiness are satisfied. Reconcile the checklist and dated Excel copy at each checkpoint.

## E002: release and historical impact screening

[PR #200](https://github.com/blendproperty/stor24-portal/pull/200) merged as `70cf5e24f470538e1fbd579c460b8540fc8218e0` after all exact-head checks passed. Main CI `35832716072` and [deployment `35832882012`](https://github.com/blendproperty/stor24-portal/actions/runs/35832882012) succeeded. The production checkout and healthy image `stor24-crm:70cf5e24f` match that release. CRM health at `2026-09-23T07:42:17.627Z` reported application/database `ok`; public Midpoint detail retained 142 units and both upper floors in `comingSoonFloors`. No schema/configuration change was needed. This is release/readback evidence, not a production expiry rehearsal or Brett's acceptance.

A bounded `BEGIN READ ONLY` transaction on the verified production database, followed by `ROLLBACK`, screened signed agreements joined to their reservations, current units and `ST24-T-<reservationId>` accounts/payments. Only aggregate results are recorded here:

| Finding | Count / result |
|---|---|
| Active signed reservations | 3, none converted to tenancy |
| Cancelled signed candidates | 14, all PUBLIC_WEBSITE, none converted to tenancy |
| Current unit state for those candidates | 6 AVAILABLE; 8 RESERVED (reservation counts, not distinct units) |
| Linked payment rows | 7 SUCCEEDED; 4 PENDING; 3 FAILED |
| Payment provenance | All NETCASH / PAY_NOW; environment unspecified |

The 14 candidates are not 14 proven instances of D001, nor necessarily 14 customers. Manual cancellation and test history must be distinguished, and a stored SUCCEEDED status with unspecified environment does not establish real funds or settlement. Old records lack the new expiry-specific audit evidence. No production record was reopened, reallocated or financially changed. Individual staff/finance review remains open: establish cancellation reason, test/live provenance, signed-document position and present unit rights before choosing recovery. Never restore a booking over another customer's allocation.

## E003: Brett's customer portal acceptance findings

Brett progressed beyond the initial floor check and reported these issues on 23 September. The live browser and read-only database diagnosis confirmed the following; no customer data was changed. This does not retroactively accept earlier J cases without their stated evidence.

| Defect / cases | Reproduced finding | Correction and remaining acceptance |
|---|---|---|
| D002 / J01, J06, J16 | Compact Move package R1,099 saved as RESERVED, but hidden in collapsed selections while the separate-orders section claimed no supplies purchased. No separate order existed. | Display booking package, saved items and supply status openly; distinguish reserved/test activity from paid separate orders. Browser regression passes; production release and Brett's retest remain. |
| D003 / J04, J06 | R2,199 sandbox TEST_SUCCEEDED payment; zero real ledger entries; R0 statement without nearby explanation. Payment includes R1,100 storage plus R1,099 package. | Explain test exclusion beside the account balance/statement and on PDF; preserve genuine balance and receipt rules. A reviewed/accepted ID cannot make test payment real. Reconciliation-held null balance displays Under review. Browser regression passes; production release and Brett's retest remain. |
| D004 / J02, J06 | ID upload persisted as AWAITING_REVIEW, but portal only said staff acceptance was needed. | Show upload acknowledgement/date and review state; refresh without resubmitting. Include accepted, replacement, withdrawn, expired and missing states using only customer-scoped metadata. Browser regression passes; production release and Brett's retest remain. |

Validation: 365 application tests, TypeScript and focused lint pass; actual component checks at 1440/390/320px cover all three findings, released stock, unavailable balance and account/unit isolation with zero operational writes. Build/CI, commit, merge, deployment and production proof are separately recorded in PROJECT_CONTEXT.md. P01 remains open.
