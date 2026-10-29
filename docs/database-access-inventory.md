# Database consumer and access inventory — 2026-10-29

Observed live metadata: the CRM role `stor24` owned 92 public tables and the CMS role `stor4_user` owned 24; both were superusers with BYPASSRLS and no enabled RLS. This is a point-in-time catalog observation, not proof of external reachability. Connection sampling only showed currently open clients and is not an exhaustive consumer inventory.

## CRM consumer boundaries

| Consumer | Observed use | Required scope and gaps |
| --- | --- | --- |
| Request handlers, background workers and customer portal | Shared Prisma client `src/lib/db.ts` uses `DATABASE_URL`; 211 static db-reference matches were observed. | Data read/write by model and feature; dynamic SQL, nested relations and raw operations require review. Shared runtime role cannot supply a trustworthy tenant identity by mutable setting alone. |
| Release migration | `compose.prod.yml` migrate service and `.github/workflows/deploy-vps.yml` use the same `.env` as the app; Prisma owns schema history. | Separate owner/migration identity needs DDL, migration history, functions, types, sequences and approved extension rights; do not expose it to runtime. |
| Backup | `scripts/dlp-backup.sh` runs `pg_dump` as `stor24`; restore proof uses an isolated postgres process. | Inventory full database/schema read, RLS bypass, ownership and backup custody, and independently test restores before changing identity. |
| Resource health | `scripts/production-resource-health.sh` uses `stor24` and inspects activity counts and max connections. | Review observability grants and required views; do not assume ordinary runtime rights suffice. |
| Maintenance and export | `scripts/apply-approved-merchandise.mjs`, seed/restore scripts, deploy tooling and scheduled services use direct or indirect DB access. | Classify each live consumer and separately authorize financial/operational use; static search and a point-in-time connection sample cannot establish all external clients. |

## Static CRM model operation leads

The following list is a source-search inventory, not a grant prescription: it excludes dynamic property access, raw SQL, Prisma nested operations, generated queries, database constraints, and paths outside `src`. Capitalization follows Prisma client properties. Confirm actual permissions by staging execution and owner review.

| Model property | Direct operations observed |
| --- | --- |
| `accessDecision` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `account` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `arrivalHandover` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `auditEvent` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `biometricEnrollment` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `chargeDefinition` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `collectionActivity` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `collectionCase` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `collectionPromise` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `communicationLog` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `communicationTemplate` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `configurationProfile` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `customer` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `customerNote` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `dailyClose` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `debitMandateSession` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `debitOrderInstruction` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `debitOrderRun` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `discountPlan` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `document` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `facialPhotoControl` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `facialPhotoMaintenance` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `facialPhotoSubmission` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `facility` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `facilityMap` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `financialAdjustment` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `identityDocument` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `identityDocumentMaintenance` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `insuranceEnrollment` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `insurancePlan` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `integrationConnection` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `integrationIdentityLink` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `lead` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `groupBy`, `update`, `updateMany`, `upsert` |
| `ledgerEntry` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `maintenanceRequest` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `mapElement` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `marketingActivity` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `marketingCampaign` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `marketingLink` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `merchandiseOrder` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `merchandiseOrderItem` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `mfaCredential` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `moveInTrainingControl` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `moveInTrainingRun` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `occupancy` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `organisation` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `passwordResetToken` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `payment` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `priceApprovalChallenge` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `product` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `publicDebitMandate` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `publicPaymentSession` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `publicReservationLease` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `rateLimitBucket` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `receiptBankSourceProfile` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `receiptImportPosting` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `receiptReallocation` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `reportHistoryImport` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `reportRun` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `reportSchedule` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `reservation` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `reservationPackage` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `reservationPriceAmendment` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `role` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `roleAssignment` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `savedReport` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `settlementBalanceObservation` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `settlementBankEntry` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `settlementBankImport` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `settlementLine` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `settlementStatement` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `staffOperationalAcknowledgement` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `stockMovement` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `storagePackage` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `storagePackageItem` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `task` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `tenancy` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `tenantMerchandiseRequest` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `tenantPortalChallenge` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `tenantPortalSession` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `tenantPortalWelcome` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `unidentifiedReceiptIntake` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `unidentifiedReceiptMatchProposal` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `unit` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `unitNote` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `unitType` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `user` | `aggregate`, `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `groupBy`, `update`, `updateMany`, `upsert` |
| `userInvitation` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `walkInVisit` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `update`, `updateMany`, `upsert` |
| `webhookInbox` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `groupBy`, `update`, `updateMany`, `upsert` |
| `webhookOutbox` | `count`, `create`, `createMany`, `delete`, `deleteMany`, `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `groupBy`, `update`, `updateMany`, `upsert` |

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
