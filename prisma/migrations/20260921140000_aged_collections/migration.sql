CREATE TABLE "CollectionCase" (
 "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL UNIQUE,
 "ownerId" TEXT, "nextFollowUp" TEXT, "disputed" BOOLEAN NOT NULL DEFAULT false,
 "disputeReason" TEXT, "terms" JSONB, "revision" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CollectionCase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CollectionCase_revision_check" CHECK ("revision" >= 0)
);
CREATE TABLE "CollectionActivity" (
 "id" TEXT NOT NULL PRIMARY KEY, "caseId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "action" TEXT NOT NULL, "note" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CollectionActivity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CollectionActivity_caseId_requestKey_key" ON "CollectionActivity"("caseId", "requestKey");
CREATE INDEX "CollectionActivity_caseId_createdAt_idx" ON "CollectionActivity"("caseId", "createdAt");
CREATE TABLE "CollectionPromise" (
 "id" TEXT NOT NULL PRIMARY KEY, "caseId" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL,
 "dueDate" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" TIMESTAMP(3),
 CONSTRAINT "CollectionPromise_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CollectionPromise_amount_check" CHECK ("amount" > 0),
 CONSTRAINT "CollectionPromise_status_check" CHECK ("status" IN ('OPEN', 'KEPT', 'CANCELLED'))
);
CREATE INDEX "CollectionPromise_caseId_createdAt_idx" ON "CollectionPromise"("caseId", "createdAt");
CREATE UNIQUE INDEX "CollectionPromise_one_open" ON "CollectionPromise"("caseId") WHERE "status" = 'OPEN';
