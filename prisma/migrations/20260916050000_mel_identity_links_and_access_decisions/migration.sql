-- CreateEnum
CREATE TYPE "IdentityLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'DUPLICATE_SUSPECTED', 'MANUALLY_RESOLVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AccessDecisionAction" AS ENUM ('ACTIVATE', 'SUSPEND', 'RESTORE', 'REVOKE');

-- CreateEnum
CREATE TYPE "AccessDecisionState" AS ENUM ('DESIRED', 'PENDING', 'CONFIRMED', 'FAILED', 'RECONCILIATION_REQUIRED');

-- CreateTable
CREATE TABLE "IntegrationIdentityLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "melIntegrationLinkId" TEXT,
    "hikCentralPersonId" TEXT,
    "status" "IdentityLinkStatus" NOT NULL DEFAULT 'PENDING',
    "linkedAt" TIMESTAMP(3),
    "duplicateOfLinkId" TEXT,
    "resolutionNotes" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationIdentityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessDecision" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "occupancyId" TEXT NOT NULL,
    "action" "AccessDecisionAction" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "state" "AccessDecisionState" NOT NULL DEFAULT 'DESIRED',
    "correlationId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationIdentityLink_customerId_key" ON "IntegrationIdentityLink"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationIdentityLink_organisationId_melIntegrationLinkId_key" ON "IntegrationIdentityLink"("organisationId", "melIntegrationLinkId");

-- CreateIndex
CREATE INDEX "IntegrationIdentityLink_organisationId_status_idx" ON "IntegrationIdentityLink"("organisationId", "status");

-- CreateIndex
CREATE INDEX "IntegrationIdentityLink_hikCentralPersonId_idx" ON "IntegrationIdentityLink"("hikCentralPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessDecision_correlationId_key" ON "AccessDecision"("correlationId");

-- CreateIndex
CREATE INDEX "AccessDecision_organisationId_facilityId_createdAt_idx" ON "AccessDecision"("organisationId", "facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessDecision_occupancyId_state_createdAt_idx" ON "AccessDecision"("occupancyId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "AccessDecision_state_lastAttemptAt_idx" ON "AccessDecision"("state", "lastAttemptAt");

-- AddForeignKey
ALTER TABLE "IntegrationIdentityLink" ADD CONSTRAINT "IntegrationIdentityLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationIdentityLink" ADD CONSTRAINT "IntegrationIdentityLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationIdentityLink" ADD CONSTRAINT "IntegrationIdentityLink_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDecision" ADD CONSTRAINT "AccessDecision_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDecision" ADD CONSTRAINT "AccessDecision_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDecision" ADD CONSTRAINT "AccessDecision_occupancyId_fkey" FOREIGN KEY ("occupancyId") REFERENCES "Occupancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDecision" ADD CONSTRAINT "AccessDecision_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
