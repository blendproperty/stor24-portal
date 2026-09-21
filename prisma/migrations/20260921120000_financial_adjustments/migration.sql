CREATE TABLE "FinancialAdjustment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organisationId" TEXT NOT NULL,
 "facilityId" TEXT NOT NULL,
 "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestKey" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
 "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0),
 "taxAmount" DECIMAL(14,2) NOT NULL CHECK ("taxAmount" >= 0 AND "taxAmount" <= "amount"),
 "sourceEntryId" TEXT,
 "paymentId" TEXT,
 "reason" TEXT NOT NULL,
 "evidenceReference" TEXT NOT NULL,
 "snapshot" JSONB NOT NULL,
 "fingerprint" TEXT NOT NULL,
 "requestedById" TEXT NOT NULL,
 "reviewedById" TEXT,
 "reviewReference" TEXT,
 "reviewedAt" TIMESTAMP(3),
 "postedById" TEXT,
 "postedAt" TIMESTAMP(3),
 "ledgerEntryId" TEXT,
 "documentId" TEXT,
 "payoutReference" TEXT,
 "payoutDate" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "FinancialAdjustment_kind_check" CHECK ("kind" IN ('CHARGE','CREDIT','WRITE_OFF','REVERSAL','REFUND')),
 CONSTRAINT "FinancialAdjustment_status_check" CHECK ("status" IN ('PENDING_APPROVAL','APPROVED','POSTED','REJECTED','CANCELLED'))
);
CREATE UNIQUE INDEX "FinancialAdjustment_organisationId_requestKey_key" ON "FinancialAdjustment"("organisationId","requestKey");
CREATE UNIQUE INDEX "FinancialAdjustment_organisationId_payoutReference_key" ON "FinancialAdjustment"("organisationId","payoutReference");
CREATE UNIQUE INDEX "FinancialAdjustment_ledgerEntryId_key" ON "FinancialAdjustment"("ledgerEntryId");
CREATE UNIQUE INDEX "FinancialAdjustment_documentId_key" ON "FinancialAdjustment"("documentId");
CREATE INDEX "FinancialAdjustment_organisationId_facilityId_createdAt_idx" ON "FinancialAdjustment"("organisationId","facilityId","createdAt");
CREATE INDEX "FinancialAdjustment_accountId_status_idx" ON "FinancialAdjustment"("accountId","status");
CREATE INDEX "FinancialAdjustment_sourceEntryId_idx" ON "FinancialAdjustment"("sourceEntryId");
CREATE UNIQUE INDEX "FinancialAdjustment_one_open_account" ON "FinancialAdjustment"("accountId") WHERE "status" IN ('PENDING_APPROVAL','APPROVED');
