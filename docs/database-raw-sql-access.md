# CRM raw SQL source audit leads — 2026-10-29

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
| `src/lib/request-security.ts` | `RateLimitBucket` insert |
| `src/lib/reservation-move-in.ts` | `Account` read, `Reservation` read, `Unit` read |
| `src/lib/reservation-payment.ts` | `Account` read, `Reservation` read |
| `src/lib/reservation-price-service.ts` | `Account` read, `Customer` read, `Payment` read, `PublicPaymentSession` read, `Reservation` read |
| `src/lib/scheduled-work-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/settlement-service.ts` | `Organisation` read |
| `src/lib/staff-arrivals-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/staff-event-email-source.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/staff-followup-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/staff-operational-events.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/tenant-portal-auth.ts` | `RateLimitBucket` insert |
| `src/lib/training-debtor-service.ts` | `Organisation` read |
| `src/lib/unidentified-receipt-service.ts` | `Account` read, `Organisation` read |
| `src/lib/unit-combination-service.ts` | `Facility` read, `Unit` read |
| `src/lib/visual-report-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |
| `src/lib/walk-in-service.ts` | `WalkInVisit` read |
| `src/lib/whatchimp-enquiry-service.ts` | `pg_advisory_xact_lock` and `hashtextextended`; no raw table reference found |

The 15 rows without recognized relation names were manually checked at their raw-query call sites: two are `SELECT 1` health probes and thirteen use transaction advisory locks via `pg_advisory_xact_lock` and `hashtextextended`. Other ORM calls in those files remain represented in the model leads. Remaining 70 files have keyword-based relation leads and still require manual confirmation, including aliases and dynamic fragments.
