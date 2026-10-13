# SiteLink feature-gap rollout

Updated: 13 October 2026. This is the implementation sequence requested by Brett; it is not a claim that these gaps are fixed.

| Order | Feature gap | Current rollout stage | Completion evidence required |
|---|---|---|---|
| 1 | Existing-tenant fixed monthly card autopay | Preparation/request backend implemented on this branch; live provider enrollment remains blocked. New booking choices remain once-off CARD/EFT. | Verified existing-tenant enrollment with no invented charge, merchant duration semantics, authoritative subscription and cycle identity, provider update/cancel behavior, secure tokens, separate idempotent cycle receipts, customer/staff UI and controlled provider/finance/mobile acceptance. |
| 2 | Accounting/MRI export pipeline | Queued; no changes in this branch. | Approved finance mappings/basis; balanced export batches, reversal/idempotency controls and accepted accounting readback. |
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

