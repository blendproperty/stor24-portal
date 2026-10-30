# CRM organisation and relationship map — 2026-10-30

Static snapshot of the Prisma schema: 91 mapped models, of which 53 declare a direct `organisationId` field and 38 do not. `_prisma_migrations` is a separate database table, not an application model. Relationships below are owning-side `@relation(fields: ...)` declarations, not verified authorisation paths. A missing direct field does not mean a table is public, shared, or safe to leave unprotected. For each model, establish its permitted access paths and cross-organisation relationship consistency, including nullable links, background jobs, public workflows and nested ORM operations, before designing or enabling policies. `Organisation` is keyed by its own ID; tables without an owning relation can represent system or operational state and need individual review. Some database constraints, dynamic access and objects outside the Prisma model are not represented. No grants or policies are prescribed by this map.

| Model | Database table | Direct organisationId | Owning relations detected |
| --- | --- | --- | --- |
| `AccessDecision` | `AccessDecision` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `occupancy` -> `Occupancy` (occupancyId), `requestedBy` -> `User` (requestedById) |
| `Account` | `Account` | no | `customer` -> `Customer` (customerId) |
| `ArrivalHandover` | `ArrivalHandover` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `reservation` -> `Reservation` (reservationId), `owner` -> `User` (ownerId), `cover` -> `User` (coverId) |
| `AuditEvent` | `AuditEvent` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `actor` -> `User` (actorId) |
| `BiometricEnrollment` | `BiometricEnrollment` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `customer` -> `Customer` (customerId), `occupancy` -> `Occupancy` (occupancyId) |
| `ChargeDefinition` | `ChargeDefinition` | yes | `organisation` -> `Organisation` (organisationId) |
| `CollectionActivity` | `CollectionActivity` | no | `case` -> `CollectionCase` (caseId) |
| `CollectionCase` | `CollectionCase` | no | `account` -> `Account` (accountId) |
| `CollectionPromise` | `CollectionPromise` | no | `case` -> `CollectionCase` (caseId) |
| `CommunicationLog` | `CommunicationLog` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `customer` -> `Customer` (customerId), `template` -> `CommunicationTemplate` (templateId) |
| `CommunicationTemplate` | `CommunicationTemplate` | yes | `organisation` -> `Organisation` (organisationId) |
| `ConfigurationProfile` | `ConfigurationProfile` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `Customer` | `Customer` | yes | `organisation` -> `Organisation` (organisationId) |
| `CustomerNote` | `CustomerNote` | yes | `organisation` -> `Organisation` (organisationId), `customer` -> `Customer` (customerId), `facility` -> `Facility` (facilityId), `author` -> `User` (authorId) |
| `DailyClose` | `DailyClose` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `closedBy` -> `User` (closedById) |
| `DebitMandateSession` | `DebitMandateSession` | no | `tenancy` -> `Tenancy` (tenancyId), `document` -> `Document` (documentId) |
| `DebitOrderInstruction` | `DebitOrderInstruction` | no | `run` -> `DebitOrderRun` (runId), `account` -> `Account` (accountId) |
| `DebitOrderRun` | `DebitOrderRun` | yes | none detected |
| `DiscountPlan` | `DiscountPlan` | yes | `organisation` -> `Organisation` (organisationId) |
| `Document` | `Document` | no | `tenancy` -> `Tenancy` (tenancyId) |
| `FacialPhotoControl` | `FacialPhotoControl` | yes | none detected |
| `FacialPhotoMaintenance` | `FacialPhotoMaintenance` | no | none detected |
| `FacialPhotoSubmission` | `FacialPhotoSubmission` | no | `reservation` -> `Reservation` (reservationId), `occupancy` -> `Occupancy` (occupancyId) |
| `Facility` | `Facility` | yes | `organisation` -> `Organisation` (organisationId) |
| `FacilityMap` | `FacilityMap` | no | `facility` -> `Facility` (facilityId) |
| `FinancialAdjustment` | `FinancialAdjustment` | yes | `account` -> `Account` (accountId) |
| `IdentityDocument` | `IdentityDocument` | no | `reservation` -> `Reservation` (reservationId) |
| `IdentityDocumentMaintenance` | `IdentityDocumentMaintenance` | no | none detected |
| `InsuranceEnrollment` | `InsuranceEnrollment` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `tenancy` -> `Tenancy` (tenancyId), `plan` -> `InsurancePlan` (planId) |
| `InsurancePlan` | `InsurancePlan` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `IntegrationConnection` | `IntegrationConnection` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `IntegrationIdentityLink` | `IntegrationIdentityLink` | yes | `organisation` -> `Organisation` (organisationId), `customer` -> `Customer` (customerId), `resolvedBy` -> `User` (resolvedById) |
| `Lead` | `Lead` | no | `facility` -> `Facility` (facilityId), `customer` -> `Customer` (customerId), `desiredUnitType` -> `UnitType` (desiredUnitTypeId), `assignedTo` -> `User` (assignedToId) |
| `LedgerEntry` | `LedgerEntry` | no | `account` -> `Account` (accountId), `createdBy` -> `User` (createdById) |
| `MaintenanceRequest` | `MaintenanceRequest` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `unit` -> `Unit` (unitId), `assignedTo` -> `User` (assignedToId) |
| `MapElement` | `MapElement` | no | `map` -> `FacilityMap` (mapId), `unit` -> `Unit` (unitId) |
| `MarketingActivity` | `MarketingActivity` | no | `campaign` -> `MarketingCampaign` (campaignId) |
| `MarketingCampaign` | `MarketingCampaign` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `MarketingLink` | `MarketingLink` | no | `campaign` -> `MarketingCampaign` (campaignId) |
| `MerchandiseOrder` | `MerchandiseOrder` | yes | `account` -> `Account` (accountId), `payment` -> `Payment` (paymentId) |
| `MerchandiseOrderItem` | `MerchandiseOrderItem` | no | `order` -> `MerchandiseOrder` (orderId), `product` -> `Product` (productId) |
| `MfaCredential` | `MfaCredential` | no | `user` -> `User` (userId) |
| `MoveInTrainingControl` | `MoveInTrainingControl` | yes | none detected |
| `MoveInTrainingRun` | `MoveInTrainingRun` | yes | none detected |
| `Occupancy` | `Occupancy` | no | `tenancy` -> `Tenancy` (tenancyId), `unit` -> `Unit` (unitId) |
| `Organisation` | `Organisation` | no | none detected |
| `PasswordResetToken` | `PasswordResetToken` | yes | `organisation` -> `Organisation` (organisationId), `user` -> `User` (userId) |
| `Payment` | `Payment` | no | `account` -> `Account` (accountId) |
| `PriceApprovalChallenge` | `PriceApprovalChallenge` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `amendment` -> `ReservationPriceAmendment` (amendmentId), `requester` -> `User` (requestedById), `approver` -> `User` (approverId) |
| `Product` | `Product` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `PublicDebitMandate` | `PublicDebitMandate` | no | `lease` -> `PublicReservationLease` (leaseId), `session` -> `DebitMandateSession` (sessionId) |
| `PublicPaymentSession` | `PublicPaymentSession` | no | `reservation` -> `Reservation` (reservationId) |
| `PublicReservationLease` | `PublicReservationLease` | no | `reservation` -> `Reservation` (reservationId) |
| `RateLimitBucket` | `RateLimitBucket` | no | none detected |
| `ReceiptBankSourceProfile` | `ReceiptBankSourceProfile` | yes | `organisation` -> `Organisation` (organisationId) |
| `ReceiptImportPosting` | `ReceiptImportPosting` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `intake` -> `UnidentifiedReceiptIntake` (intakeId), `proposal` -> `UnidentifiedReceiptMatchProposal` (proposalId), `account` -> `Account` (accountId), `payment` -> `Payment` (paymentId), `ledgerEntry` -> `LedgerEntry` (ledgerEntryId), `document` -> `Document` (documentId), `bankSource` -> `ReceiptBankSourceProfile` (bankSourceId), `bankEntry` -> `SettlementBankEntry` (bankEntryId), `netcashLine` -> `SettlementLine` (netcashLineId) |
| `ReceiptReallocation` | `ReceiptReallocation` | yes | `reverses` -> `ReceiptReallocation` (reversesId), `sourceAccount` -> `Account` (sourceAccountId), `targetAccount` -> `Account` (targetAccountId), `sourceEntry` -> `LedgerEntry` (sourceEntryId), `payment` -> `Payment` (paymentId), `sourceLedgerEntry` -> `LedgerEntry` (sourceLedgerEntryId), `targetLedgerEntry` -> `LedgerEntry` (targetLedgerEntryId), `sourceDocument` -> `Document` (sourceDocumentId), `targetDocument` -> `Document` (targetDocumentId) |
| `ReportHistoryImport` | `ReportHistoryImport` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `ReportRun` | `ReportRun` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `schedule` -> `ReportSchedule` (scheduleId), `requestedBy` -> `User` (requestedById) |
| `ReportSchedule` | `ReportSchedule` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `Reservation` | `Reservation` | no | `facility` -> `Facility` (facilityId), `customer` -> `Customer` (customerId), `lead` -> `Lead` (leadId), `unit` -> `Unit` (unitId), `convertedTenancy` -> `Tenancy` (convertedTenancyId) |
| `ReservationPackage` | `ReservationPackage` | no | `reservation` -> `Reservation` (reservationId), `storagePackage` -> `StoragePackage` (storagePackageId) |
| `ReservationPriceAmendment` | `ReservationPriceAmendment` | yes | none detected |
| `Role` | `Role` | yes | `organisation` -> `Organisation` (organisationId) |
| `RoleAssignment` | `RoleAssignment` | no | `user` -> `User` (userId), `role` -> `Role` (roleId), `facility` -> `Facility` (facilityId) |
| `SavedReport` | `SavedReport` | yes | `organisation` -> `Organisation` (organisationId) |
| `SettlementBalanceObservation` | `SettlementBalanceObservation` | yes | none detected |
| `SettlementBankEntry` | `SettlementBankEntry` | no | `import` -> `SettlementBankImport` (importId) |
| `SettlementBankImport` | `SettlementBankImport` | yes | `receiptBankSource` -> `ReceiptBankSourceProfile` (receiptBankSourceId) |
| `SettlementLine` | `SettlementLine` | no | `statement` -> `SettlementStatement` (statementId) |
| `SettlementStatement` | `SettlementStatement` | yes | none detected |
| `StaffOperationalAcknowledgement` | `StaffOperationalAcknowledgement` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `user` -> `User` (userId) |
| `StockMovement` | `StockMovement` | no | `product` -> `Product` (productId), `createdBy` -> `User` (createdById) |
| `StoragePackage` | `StoragePackage` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId) |
| `StoragePackageItem` | `StoragePackageItem` | no | `storagePackage` -> `StoragePackage` (storagePackageId), `product` -> `Product` (productId) |
| `Task` | `Task` | yes | `unit` -> `Unit` (unitId), `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `customer` -> `Customer` (customerId), `assignee` -> `User` (assigneeId), `createdBy` -> `User` (createdById), `cover` -> `User` (coverId) |
| `Tenancy` | `Tenancy` | no | `facility` -> `Facility` (facilityId), `customer` -> `Customer` (customerId), `account` -> `Account` (accountId) |
| `TenantMerchandiseRequest` | `TenantMerchandiseRequest` | no | `customer` -> `Customer` (customerId), `task` -> `Task` (taskId) |
| `TenantPortalChallenge` | `TenantPortalChallenge` | yes | none detected |
| `TenantPortalSession` | `TenantPortalSession` | yes | none detected |
| `TenantPortalWelcome` | `TenantPortalWelcome` | yes | none detected |
| `UnidentifiedReceiptIntake` | `UnidentifiedReceiptIntake` | yes | none detected |
| `UnidentifiedReceiptMatchProposal` | `UnidentifiedReceiptMatchProposal` | no | `intake` -> `UnidentifiedReceiptIntake` (intakeId) |
| `Unit` | `Unit` | no | `facility` -> `Facility` (facilityId), `unitType` -> `UnitType` (unitTypeId) |
| `UnitNote` | `UnitNote` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `unit` -> `Unit` (unitId), `author` -> `User` (authorId) |
| `UnitType` | `UnitType` | no | `facility` -> `Facility` (facilityId) |
| `User` | `User` | yes | `organisation` -> `Organisation` (organisationId) |
| `UserInvitation` | `UserInvitation` | yes | `organisation` -> `Organisation` (organisationId) |
| `WalkInVisit` | `WalkInVisit` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `createdBy` -> `User` (createdById), `reservation` -> `Reservation` (reservationId) |
| `WebhookInbox` | `WebhookInbox` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `connection` -> `IntegrationConnection` (connectionId) |
| `WebhookOutbox` | `WebhookOutbox` | yes | `organisation` -> `Organisation` (organisationId), `facility` -> `Facility` (facilityId), `connection` -> `IntegrationConnection` (connectionId) |
