# CRM raw SQL source audit leads â€” 2026-10-29

Static keyword matches are restricted to table names present in the disposable 84-migration CRM schema. This is a navigation aid, not a definitive SQL parser or approved grant matrix: matches may include comments, examples or CTE context, and dynamic SQL, aliases, interpolations, indirect database calls, nested operations, views and future changes may be missed. Manually review every listed file, including entries with no recognized tables. No customer data is included.

| Source file | Recognized table and operation leads |
| --- | --- |
| `src/app/api/health/route.ts` | `SELECT 1` health probe; no raw table reference found |
| `src/app/api/v1/accounts/route.ts` | `Account` read |
| `src/app/api/v1/facility-map/route.ts` | `Facility` read |
| `src/app/api/v1/leasing/[resource]/route.ts` | `Reservation` read |
| `src/app/api/v1/operations/route.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/app/api/v1/reports/history/route.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/app/api/webhooks/twilio/status/route.ts` | `CommunicationLog` read |
| `src/lib/adjustment-service.ts` | `Account` read |
| `src/lib/advertising-connection.ts` | `Organisation` read |
| `src/lib/arrears-review-task-service.ts` | `Task` read |
| `src/lib/booking-move-in-training.ts` | `AuditEvent` read, `Organisation` read |
| `src/lib/booking-test-payment.ts` | `Organisation` read |
| `src/lib/bulk-lead-cancel-service.ts` | `Lead` read |
| `src/lib/bulk-unit-pricing-service.ts` | `Facility` read, `Unit` read |
| `src/lib/collection-notice-service.ts` | `Account` read |
| `src/lib/collection-phone-service.ts` | `Account` read |
| `src/lib/collection-schedule-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/collections-service.ts` | `Account` read |
| `src/lib/combine-units-service.ts` | `Facility` read, `Unit` read |
| `src/lib/customer-contact-lock.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/customer-history-service.ts` | `Customer` read |
| `src/lib/debit-mandate-session.ts` | `Tenancy` read |
| `src/lib/debit-order-initial-payment.ts` | `Reservation` read |
| `src/lib/debit-order-service.ts` | `Account` read, `DebitOrderRun` read, `Facility` read |
| `src/lib/facial-photo-control.ts` | `Organisation` read |
| `src/lib/facial-photo-service.ts` | `Account` read, `Organisation` read, `Reservation` read |
| `src/lib/finance/billing-documents-service.ts` | `Organisation` read |
| `src/lib/floor-availability-service.ts` | `Facility` read, `Unit` read |
| `src/lib/identity-document-service.ts` | `Reservation` read |
| `src/lib/operational-notice-service.ts` | Parameterised `Facility` and `ConfigurationProfile` row locks; SELECT and UPDATE privilege leads, with organisation/store/current-role checks before use. No production grant or RLS activation. |
| `src/lib/lead-booking-stage.ts` | `Lead` read |
| `src/lib/lead-sla-service.ts` | `AuditEvent` read, `Facility` read, `Lead` read |
| `src/lib/leads-workspace-service.ts` | `Lead` read |
| `src/lib/leasing-service.ts` | `Lead` read, `Unit` read |
| `src/lib/manual-lead-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/marketing-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/merchandise-order-fulfilment.ts` | `MerchandiseOrder` read |
| `src/lib/merchandise-order-service.ts` | `Account` read, `MerchandiseOrder` read, `Product` update |
| `src/lib/merchandise-order-settlement.ts` | `MerchandiseOrder` read |
| `src/lib/mfa-credential-lock.ts` | `User` read |
| `src/lib/monthly-billing-service.ts` | `Account` read |
| `src/lib/move-in-training.ts` | `Organisation` read |
| `src/lib/operations-diagnostics.ts` | `SELECT 1` health probe; no raw table reference found |
| `src/lib/payments/booking-payment-settlement.ts` | `Account` read, `Reservation` read |
| `src/lib/payments/card-autopay-enrollment-service.ts` | `Account` read |
| `src/lib/payments/card-autopay-service.ts` | `Account` read |
| `src/lib/payments/netcash-debicheck-attempt-journal.ts` | `Account` read, `ConfigurationProfile` read, `Customer` read, `Tenancy` read |
| `src/lib/payments/netcash-debicheck-bank-consent-service.ts` | `Account` read |
| `src/lib/payments/netcash-debicheck-request-service.ts` | `Account` read |
| `src/lib/payments/netcash-debicheck-template-service.ts` | `ConfigurationProfile` read |
| `src/lib/payments/netcash-debicheck-test-worker.ts` | `Account` read, `Customer` read, `Tenancy` read |
| `src/lib/payments/netcash-payment-evidence.ts` | `Payment` read |
| `src/lib/payments/netcash-payment-request-service.ts` | `Account` read |
| `src/lib/payments/netcash-refund-service.ts` | `Account` read, `Customer` read, `Tenancy` read |
| `src/lib/payments/netcash-service.ts` | `MerchandiseOrder` read |
| `src/lib/price-manager-service.ts` | `PriceApprovalChallenge` read, `User` read |
| `src/lib/public-booking-contact.ts` | `Reservation` read |
| `src/lib/public-booking-service.ts` | `Reservation` read, `Unit` read, `WalkInVisit` read |
| `src/lib/public-hosted-mandate.ts` | `Reservation` read |
| `src/lib/public-lease-workflow.ts` | `Reservation` read |
| `src/lib/public-netcash-payment.ts` | `Reservation` read |
| `src/lib/public-payment-simulator.ts` | `Reservation` read |
| `src/lib/public-recurring-payments.ts` | `Reservation` read |
| `src/lib/public-verification-renewal.ts` | `Product` update, `Reservation` read, `Unit` read |
| `src/lib/receipt-bank-source-service.ts` | `Organisation` read |
| `src/lib/receipt-correction-training-service.ts` | `Organisation` read |
| `src/lib/receipt-import-service.ts` | `Account` read, `Organisation` read |
| `src/lib/receipt-reallocation-service.ts` | `Account` read, `Payment` read |
| `src/lib/rent-review-service.ts` | `Facility` read |
| `src/lib/request-security.ts` | `RateLimitBucket` insert, select, update |
| `src/lib/reservation-move-in.ts` | `Account` read, `Reservation` read, `Unit` read |
| `src/lib/reservation-payment.ts` | `Account` read, `Reservation` read |
| `src/lib/reservation-price-service.ts` | `Account` read, `Customer` read, `Payment` read, `PublicPaymentSession` read, `Reservation` read |
| `src/lib/scheduled-work-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/settlement-service.ts` | `Organisation` read |
| `src/lib/staff-arrivals-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/staff-event-email-source.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/staff-followup-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/staff-operational-events.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/tenant-portal-auth.ts` | `RateLimitBucket` insert, select, update |
| `src/lib/training-debtor-service.ts` | `Organisation` read |
| `src/lib/unidentified-receipt-service.ts` | `Account` read, `Organisation` read |
| `src/lib/unit-combination-service.ts` | `Facility` read, `Unit` read |
| `src/lib/visual-report-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/walk-in-service.ts` | `WalkInVisit` read |
| `src/lib/whatchimp-enquiry-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |

The 15 rows without recognized relation names were manually checked at their raw-query call sites: two are `SELECT 1` health probes and thirteen use transaction advisory locks via `pg_advisory_xact_lock` and `hashtextextended`. Other ORM calls in those files remain represented in the model leads. Remaining 70 files have keyword-based relation leads and still require manual confirmation, including aliases and dynamic fragments.

## 2026-10-30 targeted manual review

`request-security.ts` and `tenant-portal-auth.ts` use `RateLimitBucket` INSERT ON CONFLICT DO UPDATE with RETURNING: candidate privileges include INSERT, UPDATE and SELECT, subject to column-level review. `collections-service.ts` locks Account rows and uses advisory locks; `merchandise-order-service.ts` locks Account and MerchandiseOrder rows and updates Product. This is a partial review of four files, not a full access or grant approval. ORM calls, other statements and application authorization still need review.

## 2026-10-30 refreshed main-branch review

The refreshed AST scan finds 148 calls in 86 files. `operational-checklist-service.ts` adds an advisory transaction lock and a Task row lock; the extra `rent-review-service.ts` call adds a second Facility row lock. Row locks require candidate SELECT and UPDATE privileges; ORM writes and the remainder of these features require separate review. Counts in older entries describe the previous snapshot.

The 2026-10-30 raw-statement triage separately identified two AuditEvent reads, two Product updates and two RateLimitBucket upserts outside the lock/probe patterns. The Product updates read columns in expressions and filters, so candidate privileges include SELECT as well as UPDATE; INSERT conflict updates and RETURNING also require additional access. This statement triage is not a review of the surrounding feature, nested ORM activity, dynamic SQL or external consumers.

## 2026-10-30 raw statement triage

A non-generated TypeScript AST pass classified all 148 detected raw call sites in this source snapshot: 121 row-lock statements, 17 advisory-lock statements, two health probes, two local timeout settings, two AuditEvent reads, two Product updates and two RateLimitBucket upserts. The two non-lock Product updates read columns in expressions and filters; the upserts use conflict updates and RETURNING. This is a syntactic classification of detected statements, not a full security review, per-role permission approval, or proof that aliases, nested ORM activity, dynamically assembled SQL, database triggers, other source languages and external consumers are covered.
