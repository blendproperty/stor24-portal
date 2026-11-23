ALTER TABLE "MaintenanceRequest"
  ADD COLUMN "jobCard" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contractor" TEXT,
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "progressNotes" TEXT,
  ADD COLUMN "completionEvidence" TEXT,
  ADD COLUMN "repairReportedAt" TIMESTAMP(3),
  ADD COLUMN "verificationNote" TEXT;
