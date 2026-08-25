ALTER TABLE "Lead" ADD COLUMN "offlineSubmissionId" TEXT;

CREATE UNIQUE INDEX "Lead_offlineSubmissionId_key" ON "Lead"("offlineSubmissionId");
