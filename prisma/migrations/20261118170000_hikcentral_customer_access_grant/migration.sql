CREATE TABLE "HikCentralAccessGrant" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "accessLevelId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastError" TEXT,
  "grantedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HikCentralAccessGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HikCentralAccessGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HikCentralAccessGrant_status_check" CHECK ("status" IN ('PENDING','GRANTED','REVOKE_PENDING','REVOKED','LOCKED','EXTERNAL','REVIEW_REQUIRED'))
);
CREATE UNIQUE INDEX "HikCentralAccessGrant_customerId_facilityId_accessLevelId_key" ON "HikCentralAccessGrant"("customerId", "facilityId", "accessLevelId");
CREATE INDEX "HikCentralAccessGrant_organisationId_facilityId_status_idx" ON "HikCentralAccessGrant"("organisationId", "facilityId", "status");
