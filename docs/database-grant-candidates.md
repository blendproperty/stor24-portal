# Database object grant candidates â€” 2026-10-29

These are static-review leads, **not approved or complete grants**. They combine non-generated direct Prisma calls with keyword-matched raw SQL. They do not resolve nested ORM writes, aliases, dynamic SQL, triggers, foreign-key side effects, functions, sequences, migrations, backups, reporting or access through untraced clients. `No direct match` means investigate; it does not mean deny. A successful synthetic subset is not proof the proposed privilege matrix is complete.

## CRM actual tables

| Database table | Prisma model | Candidate operations observed |
| --- | --- | --- |
| `AccessDecision` | `AccessDecision` | `SELECT` |
| `Account` | `Account` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `ArrivalHandover` | `ArrivalHandover` | `INSERT`, `SELECT`, `UPDATE` |
| `AuditEvent` | `AuditEvent` | `INSERT`, `SELECT` |
| `BiometricEnrollment` | `BiometricEnrollment` | `SELECT`, `UPDATE` |
| `ChargeDefinition` | `ChargeDefinition` | `INSERT`, `SELECT`, `UPDATE` |
| `CollectionActivity` | `CollectionActivity` | `DELETE`, `INSERT`, `SELECT` |
| `CollectionCase` | `CollectionCase` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `CollectionPromise` | `CollectionPromise` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `CommunicationLog` | `CommunicationLog` | `INSERT`, `SELECT`, `UPDATE` |
| `CommunicationTemplate` | `CommunicationTemplate` | `SELECT` |
| `ConfigurationProfile` | `ConfigurationProfile` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `Customer` | `Customer` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `CustomerNote` | `CustomerNote` | `INSERT`, `SELECT` |
| `DailyClose` | `DailyClose` | `INSERT`, `SELECT`, `UPDATE` |
| `DebitMandateSession` | `DebitMandateSession` | `INSERT`, `SELECT`, `UPDATE` |
| `DebitOrderInstruction` | `DebitOrderInstruction` | `DELETE`, `SELECT` |
| `DebitOrderRun` | `DebitOrderRun` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `DiscountPlan` | `DiscountPlan` | `INSERT`, `SELECT`, `UPDATE` |
| `Document` | `Document` | `INSERT`, `SELECT`, `UPDATE` |
| `FacialPhotoControl` | `FacialPhotoControl` | `INSERT`, `SELECT`, `UPDATE` |
| `FacialPhotoMaintenance` | `FacialPhotoMaintenance` | `INSERT`, `SELECT`, `UPDATE` |
| `FacialPhotoSubmission` | `FacialPhotoSubmission` | `INSERT`, `SELECT`, `UPDATE` |
| `Facility` | `Facility` | `INSERT`, `SELECT`, `UPDATE` |
| `FacilityMap` | `FacilityMap` | `INSERT`, `SELECT`, `UPDATE` |
| `FinancialAdjustment` | `FinancialAdjustment` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `IdentityDocument` | `IdentityDocument` | `INSERT`, `SELECT`, `UPDATE` |
| `IdentityDocumentMaintenance` | `IdentityDocumentMaintenance` | `INSERT`, `SELECT`, `UPDATE` |
| `InsuranceEnrollment` | `InsuranceEnrollment` | `INSERT`, `SELECT`, `UPDATE` |
| `InsurancePlan` | `InsurancePlan` | `INSERT`, `SELECT` |
| `IntegrationConnection` | `IntegrationConnection` | `INSERT`, `SELECT`, `UPDATE` |
| `IntegrationIdentityLink` | `IntegrationIdentityLink` | `SELECT` |
| `Lead` | `Lead` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `LedgerEntry` | `LedgerEntry` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `MaintenanceRequest` | `MaintenanceRequest` | `INSERT`, `SELECT`, `UPDATE` |
| `MapElement` | `MapElement` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `MarketingActivity` | `MarketingActivity` | `INSERT`, `SELECT`, `UPDATE` |
| `MarketingCampaign` | `MarketingCampaign` | `INSERT`, `SELECT`, `UPDATE` |
| `MarketingLink` | `MarketingLink` | `INSERT` |
| `MerchandiseOrder` | `MerchandiseOrder` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `MerchandiseOrderItem` | `MerchandiseOrderItem` | `DELETE`, `INSERT`, `SELECT` |
| `MfaCredential` | `MfaCredential` | `INSERT`, `SELECT`, `UPDATE` |
| `MoveInTrainingControl` | `MoveInTrainingControl` | `INSERT`, `SELECT`, `UPDATE` |
| `MoveInTrainingRun` | `MoveInTrainingRun` | `INSERT`, `SELECT`, `UPDATE` |
| `Occupancy` | `Occupancy` | `INSERT`, `SELECT`, `UPDATE` |
| `Organisation` | `Organisation` | `INSERT`, `SELECT`, `UPDATE` |
| `PasswordResetToken` | `PasswordResetToken` | `INSERT`, `SELECT`, `UPDATE` |
| `Payment` | `Payment` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `PriceApprovalChallenge` | `PriceApprovalChallenge` | `INSERT`, `SELECT`, `UPDATE` |
| `Product` | `Product` | `INSERT`, `SELECT`, `UPDATE` |
| `PublicDebitMandate` | `PublicDebitMandate` | `INSERT`, `SELECT`, `UPDATE` |
| `PublicPaymentSession` | `PublicPaymentSession` | `INSERT`, `SELECT`, `UPDATE` |
| `PublicReservationLease` | `PublicReservationLease` | `INSERT`, `SELECT`, `UPDATE` |
| `RateLimitBucket` | `RateLimitBucket` | `INSERT`, `SELECT`, `UPDATE` |
| `ReceiptBankSourceProfile` | `ReceiptBankSourceProfile` | `INSERT`, `SELECT`, `UPDATE` |
| `ReceiptImportPosting` | `ReceiptImportPosting` | `DELETE`, `INSERT`, `SELECT` |
| `ReceiptReallocation` | `ReceiptReallocation` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `ReportHistoryImport` | `ReportHistoryImport` | `INSERT`, `SELECT` |
| `ReportRun` | `ReportRun` | `INSERT`, `SELECT`, `UPDATE` |
| `ReportSchedule` | `ReportSchedule` | `INSERT`, `SELECT`, `UPDATE` |
| `Reservation` | `Reservation` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `ReservationPackage` | `ReservationPackage` | `INSERT`, `SELECT`, `UPDATE` |
| `ReservationPriceAmendment` | `ReservationPriceAmendment` | `INSERT`, `SELECT`, `UPDATE` |
| `Role` | `Role` | `INSERT`, `SELECT`, `UPDATE` |
| `RoleAssignment` | `RoleAssignment` | `DELETE`, `INSERT`, `SELECT` |
| `SavedReport` | `SavedReport` | `INSERT`, `SELECT`, `UPDATE` |
| `SettlementBalanceObservation` | `SettlementBalanceObservation` | `INSERT`, `SELECT` |
| `SettlementBankEntry` | `SettlementBankEntry` | `INSERT`, `SELECT`, `UPDATE` |
| `SettlementBankImport` | `SettlementBankImport` | `INSERT`, `SELECT`, `UPDATE` |
| `SettlementLine` | `SettlementLine` | `INSERT`, `SELECT`, `UPDATE` |
| `SettlementStatement` | `SettlementStatement` | `INSERT`, `SELECT`, `UPDATE` |
| `StaffOperationalAcknowledgement` | `StaffOperationalAcknowledgement` | `INSERT`, `SELECT`, `UPDATE` |
| `StockMovement` | `StockMovement` | `INSERT`, `SELECT` |
| `StoragePackage` | `StoragePackage` | `INSERT`, `SELECT`, `UPDATE` |
| `StoragePackageItem` | `StoragePackageItem` | `DELETE`, `SELECT` |
| `Task` | `Task` | `INSERT`, `SELECT`, `UPDATE` |
| `Tenancy` | `Tenancy` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `TenantMerchandiseRequest` | `TenantMerchandiseRequest` | `DELETE`, `INSERT`, `SELECT` |
| `TenantPortalChallenge` | `TenantPortalChallenge` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `TenantPortalSession` | `TenantPortalSession` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `TenantPortalWelcome` | `TenantPortalWelcome` | `INSERT`, `SELECT`, `UPDATE` |
| `UnidentifiedReceiptIntake` | `UnidentifiedReceiptIntake` | `INSERT`, `SELECT`, `UPDATE` |
| `UnidentifiedReceiptMatchProposal` | `UnidentifiedReceiptMatchProposal` | `INSERT`, `SELECT`, `UPDATE` |
| `Unit` | `Unit` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `UnitNote` | `UnitNote` | `INSERT`, `SELECT` |
| `UnitType` | `UnitType` | `DELETE`, `INSERT`, `SELECT`, `UPDATE` |
| `User` | `User` | `INSERT`, `SELECT`, `UPDATE` |
| `UserInvitation` | `UserInvitation` | `INSERT`, `SELECT`, `UPDATE` |
| `WalkInVisit` | `WalkInVisit` | `INSERT`, `SELECT`, `UPDATE` |
| `WebhookInbox` | `WebhookInbox` | `INSERT`, `SELECT`, `UPDATE` |
| `WebhookOutbox` | `WebhookOutbox` | `INSERT`, `SELECT`, `UPDATE` |
| `_prisma_migrations` | Migration history | Migration identity only; restricted runtime denied in selected tests |

Row-locking `SELECT ... FOR UPDATE/SHARE` requires UPDATE on at least one column of each locked table as well as SELECT. The AST inventory conservatively flags UPDATE on every recognized table in such a query; manually verify `OF` clauses, joins and column-specific privileges. [PostgreSQL SELECT documentation](https://www.postgresql.org/docs/17/sql-select.html).

## CMS actual tables

CMS Payload generates database queries from collection, auth, upload, global and relationship behavior. Table presence and selected compatibility do not establish exact per-table required privileges. Treat the list below as the complete *observed staging table list*, not a completed grant assignment.

- `areas`
- `areas_nearby`
- `content_ideas`
- `faqs`
- `homepage_hero`
- `homepage_hero_benefits`
- `homepage_hero_slides`
- `media`
- `micro_warehousing`
- `payload_kv`
- `payload_locked_documents`
- `payload_locked_documents_rels`
- `payload_migrations` â€” migration history; runtime denied in selected tests.
- `payload_preferences`
- `payload_preferences_rels`
- `posts`
- `posts_tags`
- `storage_insights`
- `storage_insights_faqs`
- `storage_insights_internal_links`
- `storage_insights_schema_types`
- `storage_insights_secondary_keywords`
- `users`
- `users_sessions`

## Acceptance before applying any grants

Trace all 70 raw-SQL files with table leads and the 15 reviewed raw-function-only files; check the full server, background tasks, uploads, retries, finance/provider operations, exports, backup, monitoring, migrations and every external consumer. Exercise positive and negative queries, pooled connection reuse, fresh migrations and future-object privileges against a staging environment representative of production. Keep backup capabilities separate and verify behavior with RLS enabled. Do not grant or revoke based on this document alone.

2026-10-30 isolated narrow-grant review: Prisma nested writes in `src/lib/merchandise-order-service.ts` and `src/lib/settlement-service.ts` require candidate INSERT on MerchandiseOrderItem, SettlementLine and SettlementBankEntry. These were confirmed by PostgreSQL 42501 statements against synthetic fixtures. RoleAssignment UPDATE and AuditEvent/Organisation/Facility/PublicReservationLease DELETE denials were traced to test setup or cleanup and are not automatically added as production privileges. Remaining nested writes, test-only operations and consumers require review.

A clean synthetic rerun of 13 CRM integration files passed with the corrected candidate table grants and broad staging sequence access, plus explicit fixture-only UPDATE on RoleAssignment and DELETE on AuditEvent, Organisation, Facility and PublicReservationLease. Those extra privileges are needed by existing test setup/cleanup and are not justified as production application grants by this experiment. The test does not prove the full candidate matrix, RLS, external consumers or minimum column privileges.
