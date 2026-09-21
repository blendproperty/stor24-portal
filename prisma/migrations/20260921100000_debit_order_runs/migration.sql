-- AlterTable
ALTER TABLE "PublicDebitMandate" ADD COLUMN     "connectionFingerprint" TEXT,
ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "environment" TEXT;

-- CreateTable
CREATE TABLE "DebitOrderRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "actionDate" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "connectionFingerprint" TEXT NOT NULL,
    "batchName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "providerToken" TEXT,
    "reportHash" TEXT,
    "failureCode" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebitOrderRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitOrderInstruction" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "DebitOrderInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DebitOrderRun_batchName_key" ON "DebitOrderRun"("batchName");

-- CreateIndex
CREATE INDEX "DebitOrderRun_organisationId_facilityId_createdAt_idx" ON "DebitOrderRun"("organisationId", "facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "DebitOrderInstruction_runId_idx" ON "DebitOrderInstruction"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "DebitOrderInstruction_accountId_period_key" ON "DebitOrderInstruction"("accountId", "period");

-- AddForeignKey
ALTER TABLE "DebitOrderInstruction" ADD CONSTRAINT "DebitOrderInstruction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DebitOrderRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitOrderInstruction" ADD CONSTRAINT "DebitOrderInstruction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
