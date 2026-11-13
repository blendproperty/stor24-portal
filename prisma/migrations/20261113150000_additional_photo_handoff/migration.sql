CREATE TABLE "AdditionalPhotoHandoff" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "photoVersion" INTEGER NOT NULL,
  "issuedById" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdditionalPhotoHandoff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdditionalPhotoHandoff_tokenHash_key" ON "AdditionalPhotoHandoff"("tokenHash");
CREATE INDEX "AdditionalPhotoHandoff_personId_expiresAt_idx" ON "AdditionalPhotoHandoff"("personId", "expiresAt");
