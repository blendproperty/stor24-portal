# Aged collections

Item 4, 21 September 2026. `/collections` replaces the positive-balance placeholder with a scoped report and case workflow. It handles tenant accounts linked to stores within the caller's organisation and permission scope. Unlinked accounts require separate reconciliation/assignment; this is not an organisation-wide general ledger trial balance.

## Ageing basis

- Select an as-of date in South African time. Future dates are rejected. Buckets are current (due today or later), 1–30, 31–60, 61–90 and 91+ calendar days overdue.
- No due date is inferred merely from a positive account balance. An authorised user records finance-approved days after each charge's effective date, oldest-due-first allocation and an approval reference. Invoice-specific due-date overrides must belong to the account and cannot predate their charge. Saving terms does not amend an agreement, invoice, billing plan or actual ledger allocation.
- Source-linked credits/write-offs reduce their original charge first. Monthly invoice discounts reduce their matching invoice. Remaining credits and verified receipts reduce oldest due charges. Reversals change the original source's available value, preserving its age; refunds reduce their source receipt. Unapplied credit is separate from positive aged debt.
- The entire current ledger must reconcile to the stored account balance before an as-of calculation is reported. Unknown or inconsistent sources, reversal chains, currencies, duplicate/unmatched receipts, historical tests, unverified provider receipts and missing terms produce Finance review. Quarantined accounts have no displayed collectible buckets, and CSV aged values are blank. Raw current account balance remains visible for investigation.
- A receipt requires one matching non-test ZAR payment with the exact amount and suitable status, plus a payment-posting audit or verified live Netcash ledger evidence. Unverified receipts cannot fulfil promises.
- Historical reports use currently approved terms and all currently recorded entries effective by the selected day, not a frozen period-close snapshot. Subsequent backdated entries or corrected terms can change a rerun. Case states, owners, holds, follow-ups and recorded promise statuses are current. Forms and next-follow-up selection are disabled on historical screens. Server writes always validate current account state.
- The report fails explicitly above 2,000 scoped tenant accounts rather than returning partial totals. A narrower store role is currently required for larger portfolios. Read snapshots use repeatable-read transactions. Inactive/closed tenancies are not silently dropped when they still have an account.

## Staff workflow

1. Filter by store, account/tenant, owner, ageing bucket, overdue debt, finance review, due follow-up, open promise or dispute. Totals and CSV use the same filters; held but reconciled debt remains included in aged totals. Finance-review counts are explicit.
2. Review charge ageing and source account history before contact. Open next follow-up selects the next eligible account locally. It never calls, emails or sends a notice.
3. Assign an active colleague permitted to manage collections at that account's store, set a follow-up date and record the actual outcome/evidence. A plan, conversation or no-answer outcome requires a note. Old dates cannot be newly scheduled.
4. Record only an actually agreed payment promise. Amount must be positive and no more than the current verified overdue amount. Missing terms/history review, disputes, open corrections and reserved debit instructions block new promises. Only one open promise per account is allowed.
5. Open promises due today or later hold queue selection; promises covered by on-time receipts await explicit confirmation. Only new, evidenced receipts recorded and effective after the promise count, net of reversals/refunds. Prior cash, backdated receipts, credits and write-offs cannot fulfil it. Late receipts are labelled late, not kept. Cancel an invalid/late promise with an explanatory note before recording a replacement. A kept status records the historical confirmation; current coverage remains recalculated and can subsequently be invalidated by refunds/reversals.
6. Apply/resolve a dispute with evidence. It holds selection from this queue, not an already reserved/provider debit, physical access or another communication process. Pending payment confirmations, corrections and non-cancelled debit instructions also require review before queue selection; settlement processing is the separate next item.

Each save checks the account scope, locks the account, validates the current case revision, and appends a permanent activity and audit in one serializable transaction. Request-key retries are idempotent; conflicting edits must reload. A partial unique database index enforces one open promise. Notes, terms and dispute changes retain their submitted values in the immutable application activity payload. The screen shows the latest 30 activities and 20 promises; earlier history remains stored.

## Permissions and safety boundaries

`collections.view`, `collections.manage`, `collections.policy`, and `collections.export` are separate permissions. Existing `collections.*` or administrator grants include them. No live role assignment is changed by deployment. Every API operation resolves its own permission-specific store scope; writes also require same-origin requests. CSV quotes all cells and neutralises spreadsheet formula prefixes.

No ledger/payment/charge, provider upload, scheduled automation, customer communication, access action, MRI export or collection fee is created. Cases are operational records, not an instruction to collect money. Financial adjustments and provider outcomes remain in their authorised workflows.

## Validation and acceptance

Pure tests cover day boundaries/SAST, partial receipts, linked credits and discounts, terms/overrides, historical reversal timing, refunds/overpayments, reconciliation quarantine, promise cash evidence and CSV injection. Isolated PostgreSQL tests cover terms, tenant scope, assignee scope, concurrent/stale/idempotent actions, promises, dispute holds, test contamination, cash evidence and no financial/provider/communication writes. Actual-component browser tests cover filters, queue selection, notes, holds, promise confirmation, historical read-only mode, exports and desktop/mobile bounds. CI runs all three layers.

Deployment/live inspection evidence is recorded separately in canonical `PROJECT_CONTEXT.md`. Finance still needs to approve real terms, source/opening balances, oldest-due-first policy, invoice exceptions and actual debtor acceptance. Staff permissions, real customer-agreement/receipt UAT, contact/consent policy, promise/dispute handling and training remain open. No invented approval, real customer contact or production case is created to satisfy those gates.
