CREATE TABLE "SavedReport" (
  "id" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "definition" JSONB NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'PRIVATE', "archived" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedReport_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SavedReport_organisationId_ownerId_archived_idx" ON "SavedReport"("organisationId", "ownerId", "archived");
CREATE INDEX "SavedReport_organisationId_visibility_archived_idx" ON "SavedReport"("organisationId", "visibility", "archived");
ALTER TABLE "ReportRun" ADD COLUMN "encryptedResult" TEXT, ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "ReportRun_expiresAt_idx" ON "ReportRun"("expiresAt");
CREATE TABLE "ReportHistoryImport" (
  "id" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "facilityId" TEXT NOT NULL,
  "dataset" TEXT NOT NULL, "name" TEXT NOT NULL, "extractedAt" TIMESTAMP(3) NOT NULL,
  "importedById" TEXT NOT NULL, "approvalReference" TEXT NOT NULL, "sourceSha256" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL, "encryptedRows" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportHistoryImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportHistoryImport_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportHistoryImport_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ReportHistoryImport_organisationId_facilityId_dataset_creat_idx" ON "ReportHistoryImport"("organisationId", "facilityId", "dataset", "createdAt");
