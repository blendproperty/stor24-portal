CREATE TABLE "LegacyAccessPhoto" (
  "id" TEXT NOT NULL, "tenancyId" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'WAITING_REVIEW', "encryptedImage" TEXT, "imageSha256" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL, "policyHash" TEXT NOT NULL, "consentNotice" TEXT NOT NULL,
  "consentAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3), "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3), "activationRequestedAt" TIMESTAMP(3), "erasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyAccessPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyAccessPhoto_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LegacyAccessPhoto_tenancyId_key" ON "LegacyAccessPhoto"("tenancyId");
CREATE INDEX "LegacyAccessPhoto_status_expiresAt_idx" ON "LegacyAccessPhoto"("status", "expiresAt");
