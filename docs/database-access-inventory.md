# Database consumer and access inventory — 2026-10-29

Observed live metadata: the CRM role `stor24` owned 92 public tables and the CMS role `stor4_user` owned 24; both were superusers with BYPASSRLS and no enabled RLS. This is a point-in-time catalog observation, not proof of external reachability. Connection sampling only showed currently open clients and is not an exhaustive consumer inventory.

## CRM consumer boundaries

| Consumer | Observed use | Required scope and gaps |
| --- | --- | --- |
| Request handlers, background workers and customer portal | Shared Prisma client `src/lib/db.ts` uses `DATABASE_URL`; 1987 direct ORM call-pattern matches across 792 source files were observed, excluding generated code. | Data read/write by model and feature; dynamic SQL, nested relations and raw operations require review. Shared runtime role cannot supply a trustworthy tenant identity by mutable setting alone. |
| Release migration | `compose.prod.yml` migrate service and `.github/workflows/deploy-vps.yml` use the same `.env` as the app; Prisma owns schema history. | Separate owner/migration identity needs DDL, migration history, functions, types, sequences and approved extension rights; do not expose it to runtime. |
| Backup | `scripts/dlp-backup.sh` runs `pg_dump` as `stor24`; restore proof uses an isolated postgres process. | Inventory full database/schema read, RLS bypass, ownership and backup custody, and independently test restores before changing identity. |
| Resource health | `scripts/production-resource-health.sh` uses `stor24` and inspects activity counts and max connections. | Review observability grants and required views; do not assume ordinary runtime rights suffice. |
| Maintenance and export | `scripts/apply-approved-merchandise.mjs`, seed/restore scripts, deploy tooling and scheduled services use direct or indirect DB access. | Classify each live consumer and separately authorize financial/operational use; static search and a point-in-time connection sample cannot establish all external clients. |

## Static CRM model operation leads

The following mechanically searched list excludes `src/generated`, dependencies and fixtures. It is not a grant prescription: patterns may match comments or strings and it excludes aliases, dynamic property access, raw SQL, Prisma nested operations, generated queries, database constraints and paths outside `src`. Confirm actual permissions by staging execution and owner review. An earlier draft mistakenly included generated Prisma examples and overstated per-model operations; this corrected list replaces it.

| Model property | Direct operations observed |
| --- | --- |
| `accessDecision` | `findMany` |
| `account` | `aggregate`, `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `upsert` |
| `arrivalHandover` | `create`, `update` |
| `auditEvent` | `count`, `create`, `findFirst`, `findMany` |
| `biometricEnrollment` | `count`, `findFirst`, `findMany`, `update` |
| `chargeDefinition` | `findMany`, `upsert` |
| `collectionActivity` | `create`, `deleteMany`, `findMany`, `findUnique` |
| `collectionCase` | `count`, `create`, `deleteMany`, `findMany`, `findUnique`, `update` |
| `collectionPromise` | `count`, `create`, `deleteMany`, `findFirst`, `update` |
| `communicationLog` | `count`, `create`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `communicationTemplate` | `findFirst` |
| `configurationProfile` | `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `customer` | `count`, `create`, `delete`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany` |
| `customerNote` | `count`, `create`, `findMany`, `findUnique` |
| `dailyClose` | `create`, `findFirst`, `findMany`, `findUniqueOrThrow`, `updateMany` |
| `debitMandateSession` | `findUnique`, `updateMany`, `upsert` |
| `debitOrderInstruction` | `count`, `deleteMany`, `findMany` |
| `debitOrderRun` | `create`, `deleteMany`, `findMany`, `update`, `updateMany` |
| `discountPlan` | `findMany`, `upsert` |
| `document` | `count`, `create`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany` |
| `facialPhotoControl` | `findUnique`, `upsert` |
| `facialPhotoMaintenance` | `findUnique`, `upsert` |
| `facialPhotoSubmission` | `count`, `findFirst`, `findMany`, `findUnique`, `update`, `upsert` |
| `facility` | `count`, `create`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `upsert` |
| `facilityMap` | `create`, `findUnique`, `update`, `upsert` |
| `financialAdjustment` | `aggregate`, `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update` |
| `identityDocument` | `count`, `findFirst`, `findMany`, `findUnique`, `update`, `upsert` |
| `identityDocumentMaintenance` | `upsert` |
| `insuranceEnrollment` | `findFirst`, `findMany`, `update`, `updateMany`, `upsert` |
| `insurancePlan` | `create`, `findFirst`, `findMany` |
| `integrationConnection` | `create`, `findFirst`, `findMany`, `findUniqueOrThrow`, `update` |
| `integrationIdentityLink` | `findMany` |
| `lead` | `aggregate`, `count`, `create`, `delete`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `groupBy`, `update`, `updateMany` |
| `ledgerEntry` | `aggregate`, `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `updateMany` |
| `maintenanceRequest` | `count`, `create`, `findFirst`, `findMany`, `update`, `updateMany` |
| `mapElement` | `count`, `createMany`, `delete`, `deleteMany`, `update`, `updateMany` |
| `marketingActivity` | `create`, `findFirst`, `findMany`, `updateMany` |
| `marketingCampaign` | `create`, `findFirst`, `findMany`, `updateMany` |
| `marketingLink` | `create` |
| `merchandiseOrder` | `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update` |
| `merchandiseOrderItem` | `deleteMany` |
| `mfaCredential` | `findUnique`, `update`, `upsert` |
| `moveInTrainingControl` | `findUnique`, `upsert` |
| `moveInTrainingRun` | `findFirst`, `findUnique`, `update`, `upsert` |
| `occupancy` | `count`, `create`, `findFirst`, `findFirstOrThrow`, `findMany`, `update`, `updateMany` |
| `organisation` | `findUnique`, `findUniqueOrThrow`, `upsert` |
| `passwordResetToken` | `create`, `findUnique`, `updateMany` |
| `payment` | `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `priceApprovalChallenge` | `create`, `findFirst`, `update`, `updateMany` |
| `product` | `count`, `create`, `findFirst`, `findMany`, `update`, `updateMany` |
| `publicDebitMandate` | `create`, `findFirst`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany` |
| `publicPaymentSession` | `count`, `create`, `findMany`, `findUnique`, `update`, `updateMany` |
| `publicReservationLease` | `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `receiptBankSourceProfile` | `create`, `findFirst`, `findMany`, `findUnique`, `update` |
| `receiptImportPosting` | `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique` |
| `receiptReallocation` | `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `update`, `updateMany` |
| `reportHistoryImport` | `create`, `findFirst`, `findMany`, `findUnique` |
| `reportRun` | `create`, `findFirst`, `findMany`, `update`, `updateMany` |
| `reportSchedule` | `count`, `create`, `findFirst`, `findMany`, `update`, `updateMany` |
| `reservation` | `aggregate`, `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany` |
| `reservationPackage` | `create`, `findUnique`, `update` |
| `reservationPriceAmendment` | `count`, `create`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `updateMany` |
| `role` | `findMany`, `findUnique`, `findUniqueOrThrow`, `upsert` |
| `roleAssignment` | `create`, `deleteMany` |
| `savedReport` | `count`, `create`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `updateMany` |
| `settlementBalanceObservation` | `create`, `findMany` |
| `settlementBankEntry` | `findFirst`, `findMany`, `findUniqueOrThrow`, `updateMany` |
| `settlementBankImport` | `create`, `findFirst`, `findMany`, `update` |
| `settlementLine` | `count`, `findFirst`, `findMany`, `findUniqueOrThrow`, `update`, `updateMany` |
| `settlementStatement` | `create`, `findFirst`, `findMany`, `update` |
| `staffOperationalAcknowledgement` | `findMany`, `findUnique`, `upsert` |
| `stockMovement` | `create`, `findMany`, `findUnique` |
| `storagePackage` | `create`, `findFirst`, `findMany`, `update` |
| `storagePackageItem` | `deleteMany` |
| `task` | `aggregate`, `count`, `create`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `tenancy` | `count`, `create`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `update` |
| `tenantMerchandiseRequest` | `count`, `create`, `deleteMany`, `findMany`, `findUnique` |
| `tenantPortalChallenge` | `create`, `deleteMany`, `update`, `updateMany` |
| `tenantPortalSession` | `create`, `deleteMany`, `findFirst`, `updateMany` |
| `tenantPortalWelcome` | `createMany`, `findUniqueOrThrow`, `update`, `updateMany` |
| `unidentifiedReceiptIntake` | `create`, `findFirst`, `findMany`, `findUnique`, `update` |
| `unidentifiedReceiptMatchProposal` | `create`, `update`, `updateMany` |
| `unit` | `aggregate`, `count`, `create`, `delete`, `deleteMany`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany` |
| `unitNote` | `create`, `findMany` |
| `unitType` | `count`, `create`, `delete`, `findFirst`, `update` |
| `user` | `count`, `create`, `findFirst`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany` |
| `userInvitation` | `create`, `findFirst`, `findMany`, `findUnique`, `update`, `updateMany` |
| `walkInVisit` | `create`, `findMany`, `findUnique`, `update` |
| `webhookInbox` | `create`, `findFirst`, `findMany`, `findUnique`, `groupBy`, `update`, `upsert` |
| `webhookOutbox` | `count`, `create`, `findMany`, `findUniqueOrThrow`, `groupBy`, `update`, `updateMany` |

## CRM raw SQL review queue

Static search identified 85 non-generated source files containing Prisma raw-query calls. The [raw SQL access map](database-raw-sql-access.md) supplies table and operation leads. Their table accesses and any dynamically constructed SQL still need individual review; the list is an audit queue, not proof of required grants.

- `src/app/api/health/route.ts`
- `src/app/api/v1/accounts/route.ts`
- `src/app/api/v1/facility-map/route.ts`
- `src/app/api/v1/leasing/[resource]/route.ts`
- `src/app/api/v1/operations/route.ts`
- `src/app/api/v1/reports/history/route.ts`
- `src/app/api/webhooks/twilio/status/route.ts`
- `src/lib/adjustment-service.ts`
- `src/lib/advertising-connection.ts`
- `src/lib/arrears-review-task-service.ts`
- `src/lib/booking-move-in-training.ts`
- `src/lib/booking-test-payment.ts`
- `src/lib/bulk-lead-cancel-service.ts`
- `src/lib/bulk-unit-pricing-service.ts`
- `src/lib/collection-notice-service.ts`
- `src/lib/collection-phone-service.ts`
- `src/lib/collection-schedule-service.ts`
- `src/lib/collections-service.ts`
- `src/lib/combine-units-service.ts`
- `src/lib/customer-contact-lock.ts`
- `src/lib/customer-history-service.ts`
- `src/lib/debit-mandate-session.ts`
- `src/lib/debit-order-initial-payment.ts`
- `src/lib/debit-order-service.ts`
- `src/lib/facial-photo-control.ts`
- `src/lib/facial-photo-service.ts`
- `src/lib/finance/billing-documents-service.ts`
- `src/lib/floor-availability-service.ts`
- `src/lib/identity-document-service.ts`
- `src/lib/lead-booking-stage.ts`
- `src/lib/lead-sla-service.ts`
- `src/lib/leads-workspace-service.ts`
- `src/lib/leasing-service.ts`
- `src/lib/manual-lead-service.ts`
- `src/lib/marketing-service.ts`
- `src/lib/merchandise-order-fulfilment.ts`
- `src/lib/merchandise-order-service.ts`
- `src/lib/merchandise-order-settlement.ts`
- `src/lib/mfa-credential-lock.ts`
- `src/lib/monthly-billing-service.ts`
- `src/lib/move-in-training.ts`
- `src/lib/operations-diagnostics.ts`
- `src/lib/payments/booking-payment-settlement.ts`
- `src/lib/payments/card-autopay-enrollment-service.ts`
- `src/lib/payments/card-autopay-service.ts`
- `src/lib/payments/netcash-debicheck-attempt-journal.ts`
- `src/lib/payments/netcash-debicheck-bank-consent-service.ts`
- `src/lib/payments/netcash-debicheck-request-service.ts`
- `src/lib/payments/netcash-debicheck-template-service.ts`
- `src/lib/payments/netcash-debicheck-test-worker.ts`
- `src/lib/payments/netcash-payment-evidence.ts`
- `src/lib/payments/netcash-payment-request-service.ts`
- `src/lib/payments/netcash-refund-service.ts`
- `src/lib/payments/netcash-service.ts`
- `src/lib/price-manager-service.ts`
- `src/lib/public-booking-contact.ts`
- `src/lib/public-booking-service.ts`
- `src/lib/public-hosted-mandate.ts`
- `src/lib/public-lease-workflow.ts`
- `src/lib/public-netcash-payment.ts`
- `src/lib/public-payment-simulator.ts`
- `src/lib/public-recurring-payments.ts`
- `src/lib/public-verification-renewal.ts`
- `src/lib/receipt-bank-source-service.ts`
- `src/lib/receipt-correction-training-service.ts`
- `src/lib/receipt-import-service.ts`
- `src/lib/receipt-reallocation-service.ts`
- `src/lib/rent-review-service.ts`
- `src/lib/request-security.ts`
- `src/lib/reservation-move-in.ts`
- `src/lib/reservation-payment.ts`
- `src/lib/reservation-price-service.ts`
- `src/lib/scheduled-work-service.ts`
- `src/lib/settlement-service.ts`
- `src/lib/staff-arrivals-service.ts`
- `src/lib/staff-event-email-source.ts`
- `src/lib/staff-followup-service.ts`
- `src/lib/staff-operational-events.ts`
- `src/lib/tenant-portal-auth.ts`
- `src/lib/training-debtor-service.ts`
- `src/lib/unidentified-receipt-service.ts`
- `src/lib/unit-combination-service.ts`
- `src/lib/visual-report-service.ts`
- `src/lib/walk-in-service.ts`
- `src/lib/whatchimp-enquiry-service.ts`

## CMS consumer boundaries

| Consumer | Observed use | Required scope and gaps |
| --- | --- | --- |
| Public content and editorial CMS | Payload PostgreSQL adapter reads `DATABASE_URI`; request-level Payload access rules distinguish public and editor actions while sharing a database role. | Runtime reads and writes collections, globals, auth/session, relationship and lock tables and sequences. Exact operations are generated by Payload and cannot be fully inferred from direct source searches. |
| CMS migration | Host release invokes `payload migrate` in the CMS service environment. | A migration-only identity and protected secret path require a change to the reviewed host contract; preserve existing historical migrations and test upgrade plus rollback. |
| CMS backup | Host release invokes `pg_dump -U stor4_user -d stor4_db` and checks archive list. | Backup identity needs full reviewed read and applicable RLS behavior; archive-list success is not restore evidence. |
| Website | Website consumes CMS via HTTP, not a separately identified PostgreSQL identity. | Confirm any other external integrations and scheduled clients before production grants change. |

## Rollout and evidence limitations

The test candidates grant synthetic runtime broad CRUD on existing tables; this is compatibility testing, not a complete least-privilege matrix. A protected migration secret, separately managed backup/monitor roles, future-object default grants for the creator, full route/worker/provider tests, staging restore, connection-pool scoping and independently verified per-table RLS remain open. Preserve finance, provider, privacy, recovery and human acceptance gates.

## Disposable staging results (2026-10-29)

Both databases were migrated under a non-superuser `stage_owner` and exercised with `stage_runtime`, granted broad SELECT/INSERT/UPDATE/DELETE on the existing schema and sequence usage, with schema CREATE and migration-history access removed. This demonstrates selected compatibility, not a complete grant matrix. A separate non-superuser `stage_backup` with `pg_read_all_data` and no BYPASSRLS dumped both synthetic databases; isolated restores succeeded and table/column counts matched. If production RLS is later enabled, backup policy or an explicitly reviewed bypass capability will be needed; a successful dump without RLS is not proof of backup completeness with RLS.

Temporary role-bound policies on real synthetic CRM Customer and CMS posts tables denied cross-scope access and showed that an unmapped shared runtime fails closed. This is a research prototype using separate database identities, not integration with actual staff, tenant, website or CMS user identities. It does not cover associated tables, joins, background jobs, pooled session context or all access paths. No production privileges or policies were changed.

A read-only host container-environment inventory on 2026-10-29 found matching PostgreSQL URL variables only in running `stor24-crm-app-1` (`DATABASE_URL`, CRM database) and `stor24-cms` (`DATABASE_URI`, CMS database). Values and passwords were not recorded. This detects only parseable URL-form variables in inspected containers at that time; it cannot rule out host scripts, other variable formats, remote clients, future jobs or indirect connections.

A further read-only inspection of the CRM app container found the environment keys `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`; a comparison performed without recording values found that the database URL login and password match the PostgreSQL user/password variables. The CMS app showed `DATABASE_URI` but not those PostgreSQL or migration-password keys. For a CRM cutover, replace the broad shared env-file arrangement with an explicitly reviewed runtime-only environment, remove privileged credentials from the running app, rotate exposed credentials where required, and verify backup, monitor and migration consumers independently. The CRM candidate adds an opt-in preflight for known credential variable names; it is not a complete secret detector and is not enforced by the existing production startup.

The [database object grant candidates](database-grant-candidates.md) enumerate 91 CRM Prisma-mapped tables plus its migration-history table and all 24 CMS staging tables. They are source-derived audit leads, not an approved or complete grant matrix.

An AST-based raw-call inventory in [database-raw-call-inventory.json](database-raw-call-inventory.json) records 145 calls in 85 non-generated source files, with relation/function name leads and source line numbers. 83 files contain interpolated or nonliteral calls; interpolation includes normally parameterized values and is not itself evidence of unsafe SQL. The audit does not resolve all dynamically assembled fragments, nested ORM writes or external consumers and cannot certify complete grants. The earlier generated-code-contaminated inventory was corrected.

## Application and recovery staging continuation (2026-10-29)

The previous operation inventory mistakenly included generated Prisma examples; the revised model table excludes generated code. A TypeScript AST pass found 145 raw-call sites in 85 non-generated files; 15 files without table-name matches were inspected and contain health probes or advisory-lock functions, while 70 files with table leads require further manual review. The object-grant matrix is a candidate inventory, not a complete production access map. Host and remote clients, dynamically assembled SQL, nested writes, provider, finance, backups and future schema still require verification.

In isolated staging the CRM actual `requireLeasingCustomer` helper and Prisma clients were tested with two non-superuser database identities and actual Customer table policies, including concurrent pool queries and denied cross-scope reads/updates. This is not integrated into real authentication or facility-level access. The CMS ran two local Next/Payload processes against separate synthetic public (read-only) and editor identities; eight real HTTP checks covered anonymous published and draft reads, editor login, draft access and denial of an authenticated editor token on the public database identity. Both processes retained application-level Payload access checks; the editor process remains a privileged surface, and real trusted routing and complete table coverage are not implemented.

A non-superuser synthetic backup role failed explicitly when RLS was enabled with no backup policy; this is a cutover blocker to resolve, not a backup solution. A separate synthetic CMS dump and restore with RLS off preserved two test posts and a related tag. The restored database passed 37 CMS API/browser checks under the restricted runtime role and the migration launcher ran successfully. Production backup data, credentials, live restore and RLS-enabled backup remain untested.

**Prototype limitation:** The synthetic CMS public identity has SELECT on all existing non-migration tables, including authentication tables, because Payload initialization and token checks were not yet decomposed into narrower privileges. RLS was applied only to `posts`; the editor identity had broad CRUD. These are test identities, not an acceptable production grant design. A compromised public process could access other granted tables regardless of the `posts` policy. The two local test servers do not establish a secure production routing boundary.

## Host systemd consumer evidence (2026-10-29)

Read-only inspection of matching files directly under `/etc/systemd/system` found `stor24-lead-sla`, `stor24-arrears-review`, `stor24-facial-photo-expiry`, `stor24-operations-status`, `stor24-dlp-backup`, `stor24-onedrive-upload` and `stor24-host-heartbeat` services. Source inspection indicates lead SLA, arrears review and facial-photo jobs call CRM HTTP endpoints, so their database use is indirect through the app role. The operations-status script invokes PostgreSQL activity metadata with `stor24`; the DLP backup invokes pg_dump with `stor24`. OneDrive upload and host heartbeat were identified but not exhaustively traced. Presence of unit files does not establish whether they are active; this listing omits user units, cron, remote hosts, renamed units and scripts outside the inspected paths.
