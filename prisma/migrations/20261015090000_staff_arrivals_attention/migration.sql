CREATE TABLE "StaffOperationalAcknowledgement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "facilityId" TEXT NOT NULL REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StaffEventAck_org_user_source_key" ON "StaffOperationalAcknowledgement"("organisationId", "userId", "sourceKey");
CREATE INDEX "StaffEventAck_org_facility_time_idx" ON "StaffOperationalAcknowledgement"("organisationId", "facilityId", "acknowledgedAt");
CREATE TABLE "ArrivalHandover" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "facilityId" TEXT NOT NULL REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reservationId" TEXT NOT NULL REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "coverId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "notes" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "coverAcknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ArrivalHandover_reservationId_key" ON "ArrivalHandover"("reservationId");
CREATE INDEX "ArrivalHandover_organisationId_facilityId_updatedAt_idx" ON "ArrivalHandover"("organisationId", "facilityId", "updatedAt");
