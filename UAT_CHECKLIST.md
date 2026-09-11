# STOR24 test tasks

Created 11 September 2026. Owner: Brett with implementation support. All boxes below are OPEN until actual evidence is recorded. Automated CI does not complete user acceptance or provider tests. Record date, environment, test reference, expected/actual result and evidence for each task; never record OTPs, bank/card details or secrets here.

## Preconditions

- [ ] Agree provider-approved test credentials/environment and permitted test amounts; no uncontrolled live charges.
- [ ] Confirm deployed CRM/public-site revisions and configuration. Keep customer merchandise checkout disabled until payment gates pass.
- [ ] Prepare authorised test users: tenant with one unit, tenant with multiple units, unrelated tenant, restricted staff and permitted staff.

## Booking and agreements

- [ ] Desktop/mobile booking: choose store/unit, see package recommendation without automatic charge, browse all products, customise quantities and verify total.
- [ ] Check package/product images, readable fields, scrolling, navigation and empty/out-of-stock states.
- [ ] Read linked full terms; explicitly accept clauses/terms and sign. Preserve accepted terms version and signed record.
- [ ] Download professional complete agreement; verify names/unit/pricing/date/terms and no unwanted duplicate download or automatic payment jump.
- [ ] Card flow: success, decline, cancellation, timeout and repeat submit; correct booking result and no duplicate charge.
- [ ] Debit-order flow: provider-approved mandate, collection-date choice, bank verification, signature/confirmation and clear next step. A setup request is not a completed mandate.

## Secure My STOR24

- [ ] Initial branded welcome email opens the correct tenant portal; OTP delivery, expiry, resend, wrong-code limits, sign-out and session expiry work.
- [ ] One-unit and multi-unit tenants see correct unit labels and only their own purchases, agreements, payments, receipts and statements.
- [ ] Attempt another tenant's document/order URL and staff route; confirm access denied without data leakage.
- [ ] Download and email a statement; verify dates, opening/closing balances, charges, payments, credits and recipient access control.
- [ ] Check receipt/agreement/statement PDF layout, branding and download on desktop/mobile. Netcash branding requires confirmed provider permission, not assumption.

## Additional merchandise

- [ ] Existing purchases appear under the correct unit. Buy more opens catalogue; images, prices, quantity limits and stock are correct.
- [ ] Switch units with a basket open: no accidental transfer of items/order to another unit.
- [ ] Successful provider payment creates exactly one order, charge/payment pair and receipt; original rent balance is unchanged.
- [ ] Declined/cancelled/pending payment is not presented as paid; reload/back/duplicate click recover the same order safely.
- [ ] Delayed success and repeated callbacks post once. Expired/cancelled-order late success becomes credit/review, not automatic fulfilment.
- [ ] Tenant sees paid/awaiting-supply and then collected/supplied after staff fulfilment; correct receipt remains accessible.

## Operations and financial controls

- [ ] Only permitted organisation/store staff can fulfil. Double-click/retry/concurrent fulfilment deducts held/on-hand stock once and records one sale/audit.
- [ ] Unpaid/review orders cannot be fulfilled. Insufficient stock gives clear error with no partial sale or status change.
- [ ] Scheduled expiry runs reliably; eligible unpaid holds release, paid orders remain intact, failures alert and retries recover.
- [ ] Reconcile provider result/settlement, order, receipt, stock movement and account statement; review refund/credit process with authorised staff.
- [ ] Check production monitoring, backup/restore and rollback procedure, permissions and staff training before controlled launch approval.

## Exit criteria

Every applicable task above has evidence and no unresolved critical defect. Legal approval, provider approval, financial reconciliation, data readiness and controlled-launch sign-off remain separate gates. No automated test or successful deployment substitutes for them.
