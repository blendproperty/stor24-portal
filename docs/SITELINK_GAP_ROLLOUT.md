# SiteLink feature-gap rollout

Updated: 14 October 2026. This is the implementation sequence requested by Brett. Implementation, protected release and operational acceptance are separate; the full gaps below remain open where acceptance or feature work is listed.

| Order | Feature gap | Current rollout stage | Completion evidence required |
|---|---|---|---|
| 1 | Existing-tenant fixed monthly card autopay | Hosted developer-account enrollment, native tenant consent/UI, original-reference schedule confirmation/deactivation and separate trace-bound test capture deployed through PR474. Creation remains off. Test-method visibility is restored, including one retained card and three Instant EFT outcomes. New bookings retain once-off CARD/EFT. | Real approved-card/OTP/return/schedule/cycle/deactivation UAT; authoritative recurring-period allocation, wider update/renewal, merchant duration/profile contracts and production/finance acceptance. Nicole confirms developer subscription testing; signing-test authority is not collection authority. |
| 2 | Accounting/MRI export pipeline | Mapping/review, BlendTest connection and internal sandbox batch preparation deployed through PR463. Separate sandbox mappings, source snapshots, exact balanced previews, independent batch review and protected review CSV. Actual test API read verified; zero accessible properties. No provider journal sent. | Assigned test entity/property; real finance GL/tax/basis decisions; accepted provider import/lookup contract, production-source allocation, broader corrections, durable submission/reconciliation and provider/finance acceptance. |
| 3 | Native financial/history reports | Current approved-plan projections and separate reviewed direct Netcash batch workflow deployed through PR470; immutable retained plan-change evidence through PR472. Original posted recurring-charge history deployed through PR486, including source holds, online totals and protected backup artifacts. Exact report runtime verified at42b78bf. | Staff/finance data reconciliation and historical coverage UAT. Later corrections, receipt/invoice allocation and cash/accrual income, prepaid, deposit and provision recognition remain separate source/finance work. Posted historical charges cannot be assumed unpaid and are not collection instructions. |
| 4 | Collection notices/actions orchestration | Individual encrypted account email drafts, independent approval and separately confirmed one-attempt sending deployed through PR467. Same-store multiple-account naming repair is pending PR489. Selected1–20-account atomic audience preparation is pending PR490; isolated PostgreSQL checks passed, protected main-base publication remains required. No real notice sent by this rollout. | Normal promotion/runtime checks for pending work; approved recipient/provider/inbox/staff UAT; bulk review/send orchestration, scheduled escalation, extra channels and separately approved fee/money/access effects remain unfinished. |
| 5 | Actual gate-passage event feed/reporting | No physical passage feed is implemented. Existing access decisions and enrolment/permission confirmations remain distinct from a recorded passage. | Provider-confirmed feed contract, gate/direction/event identity, durable duplicate handling, store scope and real device/passage verification. |

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

Netcash's public [eCommerce contract](https://api.netcash.co.za/inbound-payments/pay-now/pay-now-ecommerce/) documents tokenisation and finite cycle fields, separate initial and recurring amounts, schedule anchoring and earlier card-subscription test restrictions. Nicole’s 13 October account-specific confirmation and Netcash’s April2026 update confirm developer-account subscription testing; actual enrollment/cycle validation remains required. The older tokenisation test-mode note conflicts with the newer subscription-testing announcement; it is not used as a blanket subscription-test prohibition. Provider-hosted card vault tokens are not needed by the original-reference update contract and are discarded before inbox persistence. The [UpdateSubscriptions contract](https://api.netcash.co.za/inbound-payments/pay-now/subscription-update-service/) uses a different date encoding (CCYYMMDD) and updates finite cycles/amount/frequency/active state.

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

### Internal sandbox batch controls

Implemented while the test property and finance mappings are arranged: sandbox-only mappings; explicit tax journal side; bounded manual source snapshots; exact integer-cent included/additional-tax balancing; full original-bound reversals; mapping/source hashes; closed-month review; source/period duplicate guards; non-contributor approval; immutable approved/void records; and revision-bound protected review CSVs. Missing mappings can be saved as blocked drafts. No production financial sources or MRI financial submissions are permitted by this contract. Generic configuration cannot bypass these dedicated controls.

This reduces the preparation gap; it does not close full accounting parity. Real source recognition (income, deposits, prepaid rent and provisions), actual provider import/readback and advanced correction/reversal contracts remain required. The existing reporting closing matrix records these definition/data dependencies; unsupported figures are not invented. Physical gate passage remains a distinct missing provider feed. Email collection notices are the next independently implementable feature authorised in this conversation.

## Collection email notice increment

Brett selected email first using the existing integration. Implemented one-account-at-a-time reviewed notices with active-tenancy, reconciled ZAR debt, verified-email and explicit-consent requirements. Existing collection disputes/pending payments/instructions/adjustments/promises hold notices. Independent review and an additional scoped sending grant plus explicit confirmation are required. Contact/source changes invalidate approval. An atomic send claim prevents overlapping/repeated attempts and holds uncertain provider/persistence outcomes without retry. Provider acceptance is distinguished from inbox delivery; no recipient was actually emailed by Codex. Runbook: `docs/COLLECTION_EMAIL_NOTICES.md`.

The remaining automated escalation/campaign/channel/fee/money/access features require their own policies and provider evidence. They are not claimed closed by this first email workflow. Implementation, local/protected checks, promotion and live/UAT evidence are separate in PROJECT_CONTEXT.md.

### Sandbox integration clarification

Brett requested built-in sandbox testing and confirmed use of the stored test account. Server readback found the saved primary connection points to Blend while discovery includes BlendTest. The new `/billing/mri/sandbox` keeps a separate encrypted configuration and audit history, using current MRI discovery to confirm the exact test identifier before a bounded property read. Primary settings and financial records remain unchanged. Actual MRI read verification on 13 October succeeded against BlendTest but returned zero properties. The next blocker is a dedicated accessible sandbox property/entity, followed by test mapping approval, journal contract, balanced batches and authorised reconciliation. No test journal has been sent. The sandbox screen is deployed; authenticated staff acceptance remains open.


### Native recurring-charge increment

Current approved-plan projections, scoped filters, included tax/discount lines, explicit review exceptions and online facility totals are implemented. CSV is a backup, not the collection transport. Separate Netcash review retains store/month and uses the existing guarded direct standard-debit-order API. No production submission flags are enabled. Runbook: `docs/RECURRING_CHARGES_REPORT.md`. Historical effective plan versions, broader recognised financial reports and real provider/live collection acceptance remain gates.

### 14 October overnight increment

Retained monthly plan approvals/changes with immutable source-bound snapshots and observed legacy baselines. No historical effective periods or recognized income are invented. Netcash payment operations now distinguishes all documented provider methods, keeps tests visible, refreshes server-verified classification, and fixes pre-tenancy booking scope through exact reservation/account/customer attribution. Four prior test successes were independently reverified: one card and three Instant EFT; no payment was deleted/reposted. Card subscription developer testing is now confirmed by Nicole and the April2026 provider update, superseding blanket live-only assumptions. Full-payment coverage and remaining provider/onboarding/UAT gates are in `docs/NETCASH_FULL_PAYMENT_SCOPE_2026-10-14.md`.

### Hosted card sandbox enrollment and transaction capture

The next implementation adds tenant review/consent, a real sent/approved fully unpaid current-month invoice as the initial amount, finite future monthly hosted setup, one-attempt server schedule confirmation using the original provider invoice reference, and reviewed one-attempt deactivation. Each separately verified trace gets its own test payment and signed method evidence; original reference, organisation and store are retained without fabricating a provider reference. No period is inferred from callback timing: the verified status contract has no billing date, so receipts remain unallocated pending authoritative statement/invoice evidence. Tests never change balances, post financial receipts or export journals. Pending/uncertain provider actions cannot be automatically replayed. Withdrawn requests can be renewed while retaining the previous terms.

This is a sandbox implementation with CARD_AUTOPAY_SANDBOX_ENROLLMENT_ENABLED defaulting off. Native customer UI and protected fixtures are included; real approved-card/OTP/return/provider-schedule/cycle/deactivation UAT and operational approval are still required. Production onboarding, financial allocation/settlement/reversal/cutoff and activation remain open. SOAP payment-request/refund/delete adapters use the live WSDL but are not exposed as fully accepted operational workflows by this increment.

### Current full-payment follow-ups,14 October

Source-bound full/partial posted-debt payment requests and encrypted hosted method instructions are deployed through PR480 with creation off; actual returned links and customer/provider reconciliation UAT remain open. DebiCheck template observation and independent review are deployed through PR482 without enabling bank authentication or collection. Complete Pay Now SOAP response validation merged through protected PR487 at3045129; its deployment/runtime checkpoint remains pending. Native bank consent/authentication/submission/outcome controls, authoritative refund binding, reviewed collection-test payers/dates, settlement/reversal/retention/period allocation and production onboarding remain required. All documented hosted methods are merchant-profile choices; a label or service key is not end-to-end acceptance. See NETCASH_FULL_PAYMENT_SCOPE_2026-10-14.md and dated PROJECT_CONTEXT.md evidence.
