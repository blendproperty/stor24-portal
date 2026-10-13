# SiteLink feature-gap rollout

Updated: 13 October 2026. This is the implementation sequence requested by Brett; it is not a claim that these gaps are fixed.

| Order | Feature gap | Current rollout stage | Completion evidence required |
|---|---|---|---|
| 1 | Existing-tenant fixed monthly card autopay | Preparation/request backend merged through PR456 (`ffbec30`); live provider enrollment remains blocked. New booking choices remain once-off CARD/EFT. | Verified existing-tenant enrollment with no invented charge, merchant duration semantics, authoritative subscription and cycle identity, provider update/cancel behavior, secure tokens, separate idempotent cycle receipts, customer/staff UI and controlled provider/finance/mobile acceptance. |
| 2 | Accounting/MRI export pipeline | Finance mapping and independent review controls implemented/tested in the next review increment; no approved business mappings, balanced journals or provider posting yet. | Approved finance mappings/basis; balanced export batches, reversal/idempotency controls and accepted accounting readback. |
| 3 | Native financial/history reports | Queued; no changes in this branch. | Exact report/source definitions and reconciled test data for each selected native report. |
| 4 | Collection notices/actions orchestration | Queued; no changes in this branch. | Preview/approval/audience/consent workflow, delivery evidence, audited rules and independent provider effects. |
| 5 | Actual gate-passage event feed/reporting | Queued; no changes in this branch. | Provider-confirmed gate/direction/event identity; duplicate handling, scope and device verification. |

Price Optimizer, corporate controls, insurance automation and wider provider adapters remain feature-parity questions requiring focused confirmation. They are not assumed requirements for this first queue.

## First increment: card-autopay preparation

Scope approved in this conversation: **existing tenants, fixed monthly amount**; new bookings retain their current CARD/EFT choices.

- The tenant-scoped preparation endpoint previews approved monthly bills for a future whole-month schedule (up to 12 payments in this preparation lane), rejects changing amounts and binds the request to the account/customer/tenancy/facility and reviewed source fingerprint.
- It requires an active tenancy, a signed lease, one valid active occupancy and approved monthly billing plan. Existing debit-order setup/instructions, test payments, prepaid credit/forward charges and unsigned or changed sources require review.
- Explicit acceptance records REQUESTED with its terms version, fixed amount/date/cycles and audit. It does not store card numbers/tokens, create a Payment, change balances, issue an invoice, submit a provider form or schedule collection.
- Duplicate requests preserve one record/audit; transaction failures roll back both. A customer may withdraw a pending request. WITHDRAWN is not provider cancellation, and this code refuses to pretend an active subscription was cancelled.
- `CARD_AUTOPAY_PREPARATION_ENABLED` defaults off. No customer UI, subscription enrollment or live-money activation is shipped by this increment.
- Pure finite provider field preparation matches documented M14/M16/M17/M18/M19/M20, keeps the independently approved initial invoice amount separate, and cannot be used with an invented zero charge. It performs no request and is not exposed by the preparation route.

## Provider contracts still required

Netcash's public [eCommerce contract](https://api.netcash.co.za/inbound-payments/pay-now/pay-now-ecommerce/) documents tokenisation and finite cycle fields, separate initial and recurring amounts, schedule anchoring and live-only card-subscription tests. Tokenisation does not work in Pay Now TEST MODE. The [UpdateSubscriptions contract](https://api.netcash.co.za/inbound-payments/pay-now/subscription-update-service/) uses a different date encoding (CCYYMMDD) and updates finite cycles/amount/frequency/active state.

The published TransactionStatus/Check example proves a transaction's reference, amount and accepted result. It does not itself establish verified card ownership/token, subscription state, recurring period identity or ongoing cycle duration. Do not infer subscription confirmation from an unsigned Notify/Accept token or one successful initial payment.

The reviewed main-context explicitly leaves existing-tenant enrollment without an invented extra charge and merchant API/template duration unresolved. This increment does not guess zero/ongoing M17, change rates without renewed authority, or reuse the original once-off payment record for recurring cycles.

## Validation boundaries

Local unit policy, isolated real PostgreSQL ownership/source-change/idempotency/concurrency/withdrawal/audit-rollback checks validate the preparation increment. CI includes the new PostgreSQL test. No production/customer/provider writes or card transactions were made.

Fresh migration-chain testing encountered the pre-existing `20260909160000_package_hero_artwork` missing `imageUrl` column. The new feature introduces no migration. Its database tests used a separately created disposable database with the current schema, consistent with the repository's existing CI empty-database bootstrap approach; that does not repair or certify the old migration chain.

Implementation/testing, commit/push, merge, deployment and live verification are recorded separately in PROJECT_CONTEXT.md. The recurring-card feature gap remains open after this increment.

## Second increment: finance mapping and review controls

Brett confirmed that no finance-approved MRI entity/property, GL/tax mapping or accounting basis is available and asked for mapping and review controls now.

- `/billing/mri/mapping` is linked from MRI accounting. Organisation-wide MRI viewers can inspect it; managers can draft finance-owned entity/property, accrual/cash basis, source/exclusion notes and category rules for all six ledger movement types. No real codes or tax decisions are seeded. Additional categories distinguish rent, deposits, insurance and fees without silently treating all charges as revenue.
- Each category records debit/credit GL accounts, explicit included/additional/no-tax treatment, tax GL/code where applicable and classification/sign/reversal rationale. Drafts can remain undecided; incomplete decisions block submission and approval. Codes are recorded proposals, not validated against the provider chart of accounts.
- Saved revisions follow DRAFT → IN_REVIEW → APPROVED. A reviewer must have organisation-wide MRI management permission and must not be any contributor or the submitter. Approval requires a finance reference. Every edit clears approval; serializable, revision-bound transactions protect concurrent saves. Full version evidence and approval are audited atomically.
- The saved mapping review CSV uses audited data-protection controls and protects spreadsheet formula cells. It is explicitly **not an MRI journal import** and contains configuration rules rather than financial entries.
- No schema migration, journal compiler, automated source classification, balanced batch, bank/provider posting, Payment/LedgerEntry mutation or legacy outbox replay is introduced. Existing source-review quarantine and provider contracts remain unchanged.
- Validation: 704 unit results (703 pass, one existing skip); five isolated real PostgreSQL results; endpoint auth/scope/origin/size/rate/download guards; TypeScript, focused ESLint and production build; desktop/mobile browser flow and inspected 1440/390/320 layouts. Browser API responses are fixtures, not provider or live production evidence. CI includes the new database and browser checks.

Next accounting increment requires reviewed source classification and balanced, source-bound batches with independent journal approval, period/duplicate/reversal controls and an accepted provider import contract. Local mapping approval alone cannot close the accounting feature gap. Finance code/basis approval, opening balances and exclusions, provider test authority, reconciliation, UAT/training and production activation remain open.

