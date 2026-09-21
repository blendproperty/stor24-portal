# Recurring debit-order runs

Open Billing & payments → Debit-order runs. This is a controlled **test release** of standard EFT batch preparation, submission and upload-report tracking. Live collection, DebiCheck, automatic submission, provider-side cancellation and settlement posting are not activated.

## Workflow

1. Complete the customer's hosted Netcash mandate, independently verify its signed status, and retain the signed PDF. Newly created mandates capture their exact merchant connection and test environment. Historical mandates without this provenance require investigation; they are not relabelled as test or live.
2. In Account collection terms, record the first approved month, approval/evidence reference and confirmation that the matching reference already exists in the Netcash debit masterfile. Bank details remain with Netcash. Disable inclusion to pause future preparation; this does not recall an uploaded batch.
3. Post the approved monthly invoice. Select the store, invoice month and signed debit date, then preview. Only active/notice tenancies with a same-merchant mandate, verified PDF, verification less than 24 hours old, matching fixed amount and unambiguous balance qualify. Missing terms, pending payments, historical test-ledger contamination, credits/arrears and prior reservations are explained individually. Settled older receipts do not block a subsequent cycle.
4. Confirm the ready accounts and exclusions; save the prepared run. Each account/month is reserved uniquely. Saving creates no payment, ledger entry, communication or provider request. Original reviews remain visible in run history. Only unsent runs can be cancelled locally, preserving their saved review and audit.
5. A separately authorised provider test can enable submission for explicitly named test accounts and dates. Type the exact batch name. Evidence is rechecked and the run claimed before uploading. Concurrent requests cannot upload twice. A crash or uncertain response stays reserved for provider investigation; there is no blind retry.
6. Check the upload report. It must match the batch name, value and action date. Partial or mismatched outcomes require review. **Accepted means the file loaded; it is not a payment, payout, receipt, MRI journal or access entitlement.** Settlement and unpaid/returned transactions are subsequent work.

## Controls

- `debit_orders.view`: scoped reads and previews.
- `debit_orders.manage`: collection terms, preparation, unsent cancellation, mandate refresh and load reports.
- `debit_orders.submit`: explicitly enabled test submission.
- `NETCASH_DEBIT_TEST_SUBMISSION_ENABLED=true`, `NETCASH_DEBIT_TEST_ACCOUNT_IDS` and `NETCASH_DEBIT_TEST_ACTION_DATES` are all required. Account IDs and dates are comma-separated. Defaults are disabled/empty. Existing Netcash processing must also be enabled and merchant configuration explicitly `test`; live/unknown environments are refused.
- No collection cron or environment changes accompany deployment. Existing monthly rent billing continues unchanged.

Cut-off and holiday approval is required for every controlled test date. Only the exact signed debit day is supported; shifted dates are not substituted silently. Variable amounts, arrears allocation, replacement runs after rejection, live merchant activation, scheduling and finance acceptance remain separate gates.

## Provider evidence

Contract and SOAP parameters checked on 21 September 2026 against [Netcash compact debit-order documentation](https://api.netcash.co.za/value-added-services/compact-debit/) and the official NIWS_NIF WSDL. The connector uses CompactTwoDay, account references and amounts in cents; bank information must already exist in Netcash. Compact upload can activate referenced masterfile entries, so uploading is itself a controlled provider mutation. No upload was performed during development or deployment.

Email evidence: Mark accepted 100% retention for 22 business days on 18 September; Nicole acknowledged it for both applications. Rishka's 21 September reply still requests outstanding onboarding documents before bank compliance can proceed. This is not live STOR24 activation evidence. Provider retention remains separate from customer payment and settlement accounting.
