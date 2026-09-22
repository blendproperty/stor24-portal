CREATE TABLE "FacialPhotoSubmission" (
  "id" TEXT NOT NULL, "reservationId" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'WAITING_REVIEW', "encryptedImage" TEXT,
  "imageSha256" TEXT NOT NULL, "policyVersion" TEXT NOT NULL, "policyHash" TEXT NOT NULL,
  "consentNotice" TEXT NOT NULL, "consentAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "occupancyId" TEXT,
  "activationRequestedAt" TIMESTAMP(3), "erasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacialPhotoSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FacialPhotoSubmission_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FacialPhotoSubmission_occupancyId_fkey" FOREIGN KEY ("occupancyId") REFERENCES "Occupancy"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FacialPhotoSubmission_version_check" CHECK ("version" > 0),
  CONSTRAINT "FacialPhotoSubmission_status_check" CHECK ("status" IN ('WAITING_REVIEW','APPROVED','PENDING_PROVIDER','WITHDRAWN','REJECTED','EXPIRED'))
);
CREATE UNIQUE INDEX "FacialPhotoSubmission_reservationId_key" ON "FacialPhotoSubmission"("reservationId");
CREATE UNIQUE INDEX "FacialPhotoSubmission_occupancyId_key" ON "FacialPhotoSubmission"("occupancyId");
CREATE INDEX "FacialPhotoSubmission_status_expiresAt_idx" ON "FacialPhotoSubmission"("status", "expiresAt");
CREATE TABLE "FacialPhotoMaintenance" ("id" TEXT PRIMARY KEY, "completedAt" TIMESTAMP(3) NOT NULL);
