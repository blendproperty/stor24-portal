# Current-plan recurring charges and Netcash review

13 October 2026. Open Reports > Current-plan recurring charges (native template), or `/reports?reportKey=recurring-charges`.

Choose one complete billing month from the current South African month through twelve months ahead. Filter by permitted facility, ready/review/not-started status, recorded payment method, charge category, and account/tenant/unit search. The screen shows signed charge-line amounts, included tax and facility totals for the selected rows. It uses the current READY billing plan, the existing monthly billing calculation, approved effective rent schedules, recorded occupancy intervals and insurance premium decisions. Discounts are negative lines. Missing/invalid plans, unsupported currency, schedule not started and billing conflicts remain explicit blank-amount exceptions; narrow filters may intentionally exclude those exceptions. An existing monthly invoice reference is only an indicator, not collection eligibility. Source read uses a consistent PostgreSQL snapshot and fails above500 scoped accounts/100 occupancies per account/5000 unfiltered rows. No financial or provider writes occur.

This is a current-plan projection, including for future months. Past months are refused because approved immutable historical plan versions are not yet available. It is not historical recognized revenue, outstanding debt, a net rental liability, a debit instruction or a promise that a future rate/contact/mandate remains unchanged. Currency is ZAR for calculable rows. Full-month/prorated values and included tax follow the existing billing policy.

Online review is primary; CSV is a confidential backup through existing financial report/export/facility/DLP/personal-export permissions, atomic export audit, private headers and formula-safe encoding. CSV is not a Netcash batch import. Generic Excel/PDF requests for this report are refused; JSON preview remains available. No account bank/card/mandate secrets are reported.

## Direct Netcash collection

With separate `debit_orders.view` access, selecting one facility exposes Review Netcash debit batch. The destination retains the chosen store/month only if that store is permitted in its own workspace; it does not carry report filters into a collection audience or submit anything. Standard EFT debit orders are the existing supported direct batch lane; card subscription enrollment remains a separate provider contract.

Existing server workflow prepares a source-fingerprinted batch from signed verified mandates, confirmed masterfile references and eligible posted monthly invoices, reserves account/period instructions, validates current source/contact/payment evidence, requires explicit test account/date enablement and batch-name confirmation, durably claims before one `BatchFileUpload` request, and checks `RequestFileUploadReport`. Repeated/ambiguous uploads retain reservations; acceptance is not payment. Compact batches update existing masterfile records; they do not enroll customers or authorize a collection without the appropriate provider process. Do not infer invoice debt from report totals or implement a second upload/CSV collection route.

At the read-only runtime check on13 October, `NETCASH_DEBIT_TEST_SUBMISSION_ENABLED` is false and both approved test account/date allowlists are absent. No runtime keys/flags were changed and no provider upload/customer collection was executed. Controlled test merchant/account/date authorization, verified mandates/masterfile linkage, invoice eligibility, cutoffs/authorization, load reports, settlement/unpaid reconciliation, retention and finance/customer/staff/provider acceptance remain gates before live collection. CSV backup never bypasses those gates.

Provider contract: https://api.netcash.co.za/inbound-payments/debit-orders/ and https://api.netcash.co.za/value-added-services/compact-debit/ . Direct batch API is preferred to manual file transfer once its release gates are fulfilled.

Validation and exact promotion status are in PROJECT_CONTEXT.md. Browser fixtures and fake provider transports do not establish real acceptance or payment.

## Store identity in financial summaries

Current-plan and original-posted line records retain the permitted store id and business code. Summaries group by store identity rather than display name; identical names display their distinct store codes. Missing or conflicting attribution and unsafe monetary totals require source review. The preview shows a review message and clears old totals when source validation fails. No billing calculation, ledger balance, collection instruction, receipt or income-recognition rule is changed by this correction. Its protected promotion and database/runtime evidence remain separately recorded in PROJECT_CONTEXT.md.
