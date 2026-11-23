CREATE TABLE "ScheduledBillingCharge" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "externalRef" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "taxAmount" DECIMAL(14,2) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "recognisedAt" TIMESTAMP(3),
  "ledgerEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledBillingCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledBillingCharge_amount_check" CHECK ("amount" > 0 AND "taxAmount" >= 0 AND "taxAmount" <= "amount"),
  CONSTRAINT "ScheduledBillingCharge_recognition_check" CHECK (("recognisedAt" IS NULL) = ("ledgerEntryId" IS NULL)),
  CONSTRAINT "ScheduledBillingCharge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ScheduledBillingCharge_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScheduledBillingCharge_accountId_externalRef_key" ON "ScheduledBillingCharge"("accountId", "externalRef");
CREATE UNIQUE INDEX "ScheduledBillingCharge_ledgerEntryId_key" ON "ScheduledBillingCharge"("ledgerEntryId");
CREATE INDEX "ScheduledBillingCharge_recognisedAt_effectiveAt_idx" ON "ScheduledBillingCharge"("recognisedAt", "effectiveAt");
