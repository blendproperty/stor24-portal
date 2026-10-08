CREATE TABLE "WalkInVisit" (
 "id" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "facilityId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
 "reservationId" TEXT, "launchTokenHash" TEXT NOT NULL, "customerTokenHash" TEXT, "status" TEXT NOT NULL DEFAULT 'READY',
 "launchExpiresAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "redeemedAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WalkInVisit_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "WalkInVisit_reservationId_key" ON "WalkInVisit"("reservationId");
CREATE UNIQUE INDEX "WalkInVisit_launchTokenHash_key" ON "WalkInVisit"("launchTokenHash");
CREATE UNIQUE INDEX "WalkInVisit_customerTokenHash_key" ON "WalkInVisit"("customerTokenHash");
CREATE INDEX "WalkInVisit_organisationId_facilityId_status_expiresAt_idx" ON "WalkInVisit"("organisationId", "facilityId", "status", "expiresAt");
ALTER TABLE "WalkInVisit" ADD CONSTRAINT "WalkInVisit_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalkInVisit" ADD CONSTRAINT "WalkInVisit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalkInVisit" ADD CONSTRAINT "WalkInVisit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalkInVisit" ADD CONSTRAINT "WalkInVisit_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
