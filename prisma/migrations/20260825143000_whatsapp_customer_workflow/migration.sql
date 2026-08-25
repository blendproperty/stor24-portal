ALTER TABLE "CommunicationLog"
  ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
  ADD COLUMN "messageType" TEXT,
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN "optedOutAt" TIMESTAMP(3),
  ADD COLUMN "metadata" JSONB;

CREATE INDEX "CommunicationLog_providerRef_idx" ON "CommunicationLog"("providerRef");
CREATE INDEX "CommunicationLog_organisationId_channel_queuedAt_idx" ON "CommunicationLog"("organisationId", "channel", "queuedAt");
