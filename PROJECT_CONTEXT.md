# STOR 24 CRM and Operations Platform — Project Context

## Unit-first tenant portal — in progress, 11 September 2026

### R10 merchandise journey test — 11 September 2026

- User approved R10 testing while retaining actual basket value. Implementation: immutable isTest order marker, separately opted-in scoped/expiring identity gate, sandbox-config requirement, fixed R10 form amount and explicit test copy. Existing full-value orders are not converted to tests.
- Test settlements use TEST_PENDING/TEST_SUCCEEDED payment states, never financial SUCCEEDED. Independently verified R10 success releases the reservation only, closes the test order, writes an audit result and posts no ledger/credit/MRI export/receipt/stock sale. Basket total remains unchanged; no fulfilment eligibility. Pending/unknown provider results are not success.
- Added additive migration and isolated duplicate-settlement regression proving unchanged balance, no ledger/sale and retained basket value. CI pending. Commit/push/merge/deployment/configuration/live provider verification pending. Real settlement/fulfilment/return UAT and launch gates remain open.
- Release evidence: PR122 pushed; 5dd00fc passed validate but fresh-database CI exposed migration ordering before MerchandiseOrder creation. Renamed the new, undeployed migration to 20260911190000; 237585b passes PostgreSQL transactions job103284415743. Validation/merge/deployment still pending. VPS opt-in flag TENANT_MERCHANDISE_R10_TEST=true saved for the existing verified test identity only, expiring 18:00 UTC; runtime remains unchanged until deployment. No payment submitted.

PLACEHOLDER_REMAINING_CONTENT_TO_BE_ASSEMBLED_VIA_FOLLOWUP