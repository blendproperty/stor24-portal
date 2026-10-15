ALTER TABLE "Task"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "coverId" TEXT,
  ADD COLUMN "coverAcknowledgedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Task_requestKey_key" ON "Task"("requestKey");
CREATE INDEX "Task_organisationId_facilityId_purpose_status_dueAt_idx" ON "Task"("organisationId", "facilityId", "purpose", "status", "dueAt");
ALTER TABLE "Task" ADD CONSTRAINT "Task_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
