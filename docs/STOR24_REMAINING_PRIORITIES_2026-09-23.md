# STOR24 remaining priorities — 23 September 2026

This current work order supersedes the older Netcash-first list for sequencing. Brett confirmed Priority 1 as complete customer-journey acceptance. The order below is a proposed programme sequence; it does not change deferred provider activation, financial authority or legal decisions. Current PROJECT_CONTEXT.md release evidence takes precedence over older uncompleted checklists.

| Priority | Remaining work | Current boundary and completion evidence |
|---|---|---|
| 1 | Complete customer journey and recovery | Prove booking → ID review → signed agreement → payment → staff handover → active tenancy → move-out. Staff must verify documents, balances, unit availability and audits. Cover rejected/replaced ID, expired holds, abandoned/failed/retried payment, duplicate callbacks, refresh/resume and blocked handover. Separate simulated payment evidence from genuine provider acceptance. |
| 2 | Finance acceptance and account reconciliation | Billing, adjustments/refunds, ageing and settlement workspaces are deployed. Approve real opening balances, test-history reconciliation, rent/fees/discounts/insurance, tax, due terms, refund controls and reviewer roles. Prove monthly invoice/receipt/statement totals agree before automation cut-over. |
| 3 | Real Netcash payments and debit orders | Live activation remains explicitly deferred. Finish approved merchant/mandate configuration, provider test cases, failed/unpaid/disputed transactions and actual settlement proof before any authorised live activation. Enhanced monthly automation and debit submissions are not enabled merely by code deployment. |
| 4 | Precinct / physical access lifecycle | Private photo queue exists but collection remains held for policy approval. Complete installed-provider activation, suspension/restoration, revocation/deletion and uncertain-outcome reconciliation; prove actual entry and removal at Midpoint with an operator and consenting participant. |
| 5 | MRI journal integration | Authentication/database access are verified. Confirm the permitted journal endpoint, property/entity and GL/tax mappings, then implement controlled submission, duplicate detection, corrections and reconciliation. Existing source preparation is not journal posting. |
| 6 | Operational settings and daily close | Verify stored defaults are enforced by actual workflows; finish gaps in daily balancing, exception ownership and controlled period closure. Define which settings are operational versus informational and prove real report/source agreement. |
| 7 | Merchandise operations | Catalogue, packages, stock movement and checkout foundations do not establish full counter POS, supplier receiving, stocktake/transfers, linked financial returns and retail reporting. Finish the agreed scope and prove order/payment/stock/fulfilment/expiry reconciliation. A storage-only launch may explicitly defer retail scope. |
| 8 | Customer communications and tenant portal acceptance | Prove current email/SMS/WhatsApp delivery, recipient/consent rules, inbound association and failure/retry without duplicates. Verify My STOR24 documents, statements and status across units/devices. Lifecycle WhatsApp enablement remains a separate decision. |
| 9 | Commercial/legal/insurance decisions | Close transfer-document and mandate-treatment decisions, final agreement/notice wording approval, approved insurance product/premium/cover and cancellation treatment. Preserve existing signed documents and do not invent approval from publication. |
| 10 | Privacy and identity/access retention operations | Actual tenancy-duration ID retention is implemented. Close notice/backup-retention approval, access-photo consent and alternative-access policy, erasure/restoration procedures and staff responsibilities; prove operational deletion and access boundaries. |
| 11 | Security and resilience | Complete role/facility isolation acceptance, remaining staff/CMS MFA, dependency remediation and recovery controls. Demonstrate backup restoration, monitoring/alerts, rollback and named incident ownership. |
| 12 | Offline and multi-device recovery | Prove the supported encrypted offline workflow on two real devices: stale availability, duplicate sync, competing requests and reconnect/update recovery. Closed-floor and other stale requests must remain provisional until server validation. |
| 13 | Data readiness, training and launch sign-off | Reconcile actual units/rates/customers/opening balances, rehearse any approved migration, train staff by role, close critical UAT defects and obtain named launch/support/rollback sign-off. |

## Already shipped; do not rebuild from old notes

- Polished staff dashboards and guided help.
- Midpoint floor operating switches and public disabled Coming soon tabs; public exclusion and desktop display verified live on 23 September.
- Monthly billing, controlled debit-run preparation, adjustments/refunds, aged collections and settlement workspaces. Their real financial/provider acceptance and enabled automation are separate gates.
- ID collection/tenancy retention, private access-photo queue, booking email continuity and move-in presentation improvements, with the recorded scope and approvals retained.
- MRI connection and accounting source preparation; journal posting remains open.

This register is a source-based readiness review, not fresh functional acceptance of every item. Current floor release and its live checks are separately recorded in both repositories. No financial, identity, signing, provider or customer-messaging action is authorised by this list.
