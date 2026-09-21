-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "providerMerchantKey" TEXT;

-- CreateTable
CREATE TABLE "SettlementStatement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "merchantLabel" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "rawEncrypted" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "opening" DECIMAL(18,4) NOT NULL,
    "closing" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "transactionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "vat" DECIMAL(18,4) NOT NULL,
    "extras" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "paymentId" TEXT,
    "adjustmentId" TEXT,
    "bankEntryId" TEXT,
    "reference" TEXT,
    "resolutionSnapshot" JSONB,
    "resolutionHash" TEXT,
    "resolvedById" TEXT,
    "requestKey" TEXT,

    CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBankImport" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "bankKey" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "rawEncrypted" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementBankImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBankEntry" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "bankKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "transactionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reference" TEXT NOT NULL,

    CONSTRAINT "SettlementBankEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBalanceObservation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "merchantLabel" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "observedDate" TEXT NOT NULL,
    "current" DECIMAL(18,4) NOT NULL,
    "available" DECIMAL(18,4) NOT NULL,
    "reference" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementBalanceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementStatement_organisationId_date_idx" ON "SettlementStatement"("organisationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementLine_statementId_transactionId_key" ON "SettlementLine"("statementId", "transactionId");

-- CreateIndex
CREATE INDEX "SettlementBankImport_organisationId_createdAt_idx" ON "SettlementBankImport"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementBankEntry_importId_idx" ON "SettlementBankEntry"("importId");

-- CreateIndex
CREATE INDEX "SettlementBalanceObservation_organisationId_createdAt_idx" ON "SettlementBalanceObservation"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "SettlementStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementBankEntry" ADD CONSTRAINT "SettlementBankEntry_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SettlementBankImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Active reservations survive review and are released only by an audited void.
CREATE UNIQUE INDEX "SettlementStatement_active_day" ON "SettlementStatement" ("merchantKey", "date") WHERE "status" <> 'VOID';
CREATE UNIQUE INDEX "SettlementLine_active_provider_id" ON "SettlementLine" ("merchantKey", "transactionId") WHERE "active";
CREATE UNIQUE INDEX "SettlementLine_active_payment" ON "SettlementLine" ("paymentId") WHERE "active" AND "paymentId" IS NOT NULL;
CREATE UNIQUE INDEX "SettlementLine_active_adjustment" ON "SettlementLine" ("adjustmentId") WHERE "active" AND "adjustmentId" IS NOT NULL;
CREATE UNIQUE INDEX "SettlementLine_active_bank" ON "SettlementLine" ("bankEntryId") WHERE "active" AND "bankEntryId" IS NOT NULL;
CREATE UNIQUE INDEX "SettlementLine_request" ON "SettlementLine" ("statementId", "requestKey") WHERE "requestKey" IS NOT NULL;
CREATE UNIQUE INDEX "SettlementBankEntry_active_source" ON "SettlementBankEntry" ("bankKey", "transactionId") WHERE "active";
ALTER TABLE "SettlementStatement" ADD CONSTRAINT "SettlementStatement_state" CHECK ("status" IN ('DRAFT','REVIEWED','VOID') AND "environment" IN ('live','sandbox') AND "revision" >= 0);
ALTER TABLE "SettlementBankImport" ADD CONSTRAINT "SettlementBankImport_state" CHECK ("status" IN ('ACTIVE','VOID') AND "environment" IN ('live','sandbox'));
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_kind" CHECK ("kind" IN ('RECEIPT','RETURN','PAYOUT','BANK_RETURN','FEE','OTHER'));
ALTER TABLE "SettlementBalanceObservation" ADD CONSTRAINT "SettlementBalanceObservation_amount" CHECK ("available" <= "current" AND "environment" IN ('live','sandbox'));
