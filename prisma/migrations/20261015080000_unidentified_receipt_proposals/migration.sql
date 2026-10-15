CREATE TABLE "UnidentifiedReceiptIntake" (
 "id" TEXT NOT NULL PRIMARY KEY, "organisationId" TEXT NOT NULL, "facilityId" TEXT NOT NULL,
 "sourceType" TEXT NOT NULL, "sourceId" TEXT, "sourceIdentity" TEXT NOT NULL, "sourceFingerprint" TEXT NOT NULL,
 "evidenceEncrypted" TEXT NOT NULL, "sourceEnvironment" TEXT NOT NULL, "receiptDate" TEXT NOT NULL,
 "amount" DECIMAL(14,2) NOT NULL CHECK ("amount">0), "currency" TEXT NOT NULL DEFAULT 'ZAR' CHECK ("currency"='ZAR'),
 "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','PROPOSED','REVIEWED','WITHDRAWN')),
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0), "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "capturedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "UnidentifiedReceiptIntake_organisationId_sourceIdentity_key" ON "UnidentifiedReceiptIntake"("organisationId","sourceIdentity");
CREATE UNIQUE INDEX "UnidentifiedReceiptIntake_organisationId_requestKey_key" ON "UnidentifiedReceiptIntake"("organisationId","requestKey");
CREATE INDEX "UnidentifiedReceiptIntake_org_store_created_id_idx" ON "UnidentifiedReceiptIntake"("organisationId","facilityId","createdAt","id");
CREATE TABLE "UnidentifiedReceiptMatchProposal" (
 "id" TEXT NOT NULL PRIMARY KEY, "intakeId" TEXT NOT NULL REFERENCES "UnidentifiedReceiptIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "accountId" TEXT NOT NULL, "accountFingerprint" TEXT NOT NULL, "sourceFingerprint" TEXT NOT NULL, "detailsEncrypted" TEXT NOT NULL,
 "proposedById" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PROPOSED' CHECK ("status" IN ('PROPOSED','REVIEWED','REJECTED','SUPERSEDED','WITHDRAWN')),
 "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "reviewReference" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "UnidentifiedReceiptMatchProposal_intakeId_createdAt_idx" ON "UnidentifiedReceiptMatchProposal"("intakeId","createdAt");
