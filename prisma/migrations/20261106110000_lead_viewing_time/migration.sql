ALTER TABLE "Lead" ADD COLUMN "viewingAt" TIMESTAMP(3);
CREATE INDEX "Lead_facilityId_viewingAt_idx" ON "Lead"("facilityId", "viewingAt");
