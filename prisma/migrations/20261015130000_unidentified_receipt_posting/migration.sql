CREATE TABLE "ReceiptBankSourceProfile" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "bankIdentityHash" TEXT NOT NULL CHECK ("bankIdentityHash" ~ '^[a-f0-9]{64}$'),
 "bankCode" TEXT NOT NULL CHECK ("bankCode" ~ '^[A-Z]{4}ZA[A-Z0-9]{2}$'),
 "accountSuffix" TEXT NOT NULL CHECK ("accountSuffix" ~ '^[0-9]{1,4}$'),
 "label" TEXT NOT NULL,"currency" TEXT NOT NULL DEFAULT 'ZAR' CHECK ("currency"='ZAR'),
 "identityEncrypted" TEXT NOT NULL,"identitySignature" TEXT NOT NULL CHECK ("identitySignature" ~ '^[a-f0-9]{64}$'),
 "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK ("status" IN ('PENDING_REVIEW','APPROVED','REJECTED','WITHDRAWN','REVOKED')),
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0),
 "requestedById" TEXT NOT NULL,"requestKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"requestReference" TEXT NOT NULL,
 "reviewedById" TEXT,"reviewedAt" TIMESTAMP(3),"reviewReference" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ReceiptBankSourceProfile_organisationId_bankIdentityHash_key" ON "ReceiptBankSourceProfile"("organisationId","bankIdentityHash");
CREATE UNIQUE INDEX "ReceiptBankSourceProfile_organisationId_requestKey_key" ON "ReceiptBankSourceProfile"("organisationId","requestKey");
CREATE INDEX "ReceiptBankSourceProfile_organisationId_status_createdAt_idx" ON "ReceiptBankSourceProfile"("organisationId","status","createdAt");

ALTER TABLE "SettlementBankImport" ADD COLUMN "receiptBankSourceId" TEXT,
 ADD COLUMN "receiptBankIdentitySignature" TEXT,
 ADD CONSTRAINT "SettlementBankImport_receiptBankSourceId_fkey" FOREIGN KEY ("receiptBankSourceId") REFERENCES "ReceiptBankSourceProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "SettlementBankImport_receipt_bank_source_pair_check" CHECK (
  ("receiptBankSourceId" IS NULL AND "receiptBankIdentitySignature" IS NULL) OR
  ("receiptBankSourceId" IS NOT NULL AND "receiptBankIdentitySignature" ~ '^[a-f0-9]{64}$')
 );

ALTER TABLE "UnidentifiedReceiptIntake" DROP CONSTRAINT "UnidentifiedReceiptIntake_status_check";
ALTER TABLE "UnidentifiedReceiptIntake" ADD CONSTRAINT "UnidentifiedReceiptIntake_status_check" CHECK ("status" IN ('OPEN','PROPOSED','REVIEWED','WITHDRAWN','POSTED'));

CREATE TABLE "ReceiptImportPosting" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "facilityId" TEXT NOT NULL REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "intakeId" TEXT NOT NULL REFERENCES "UnidentifiedReceiptIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "proposalId" TEXT NOT NULL REFERENCES "UnidentifiedReceiptMatchProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "paymentId" TEXT NOT NULL REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "ledgerEntryId" TEXT NOT NULL REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "bankSourceId" TEXT REFERENCES "ReceiptBankSourceProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sourceIdentity" TEXT NOT NULL,"sourceFingerprint" TEXT NOT NULL,
 "bankEntryId" TEXT REFERENCES "SettlementBankEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "netcashLineId" TEXT REFERENCES "SettlementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "amount" DECIMAL(14,2) NOT NULL CHECK ("amount">0),"currency" TEXT NOT NULL DEFAULT 'ZAR' CHECK ("currency"='ZAR'),
 "originalReceiptDate" TEXT NOT NULL,"snapshot" JSONB NOT NULL,
 "snapshotHash" TEXT NOT NULL CHECK ("snapshotHash" ~ '^[a-f0-9]{64}$'),
 "requestKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"postedById" TEXT NOT NULL,"approvalReference" TEXT NOT NULL,
 "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReceiptImportPosting_original_source_check" CHECK (
  ("bankEntryId" IS NOT NULL AND "netcashLineId" IS NULL AND "bankSourceId" IS NOT NULL) OR
  ("bankEntryId" IS NULL AND "netcashLineId" IS NOT NULL AND "bankSourceId" IS NULL)
 )
);
CREATE UNIQUE INDEX "ReceiptImportPosting_intakeId_key" ON "ReceiptImportPosting"("intakeId");
CREATE UNIQUE INDEX "ReceiptImportPosting_proposalId_key" ON "ReceiptImportPosting"("proposalId");
CREATE UNIQUE INDEX "ReceiptImportPosting_paymentId_key" ON "ReceiptImportPosting"("paymentId");
CREATE UNIQUE INDEX "ReceiptImportPosting_ledgerEntryId_key" ON "ReceiptImportPosting"("ledgerEntryId");
CREATE UNIQUE INDEX "ReceiptImportPosting_documentId_key" ON "ReceiptImportPosting"("documentId");
CREATE UNIQUE INDEX "ReceiptImportPosting_bankEntryId_key" ON "ReceiptImportPosting"("bankEntryId");
CREATE UNIQUE INDEX "ReceiptImportPosting_netcashLineId_key" ON "ReceiptImportPosting"("netcashLineId");
CREATE UNIQUE INDEX "ReceiptImportPosting_organisationId_sourceIdentity_key" ON "ReceiptImportPosting"("organisationId","sourceIdentity");
CREATE UNIQUE INDEX "ReceiptImportPosting_organisationId_requestKey_key" ON "ReceiptImportPosting"("organisationId","requestKey");
CREATE INDEX "ReceiptImportPosting_organisationId_facilityId_postedAt_id_idx" ON "ReceiptImportPosting"("organisationId","facilityId","postedAt","id");
