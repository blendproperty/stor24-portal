-- CreateEnum
CREATE TYPE "FacialSubmissionStatus" AS ENUM ('AWAITING_STAFF', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "FacialPhotoSubmission" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "FacialSubmissionStatus" NOT NULL DEFAULT 'AWAITING_STAFF',
    "imageData" BYTEA NOT NULL,
    "imageSha256" TEXT NOT NULL,
    "imageMimeType" TEXT NOT NULL,
    "consentPolicyVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "submitterIpHash" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "enrollmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacialPhotoSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacialPhotoSubmission_organisationId_facilityId_status_idx" ON "FacialPhotoSubmission"("organisationId", "facilityId", "status");

-- CreateIndex
CREATE INDEX "FacialPhotoSubmission_reservationId_status_idx" ON "FacialPhotoSubmission"("reservationId", "status");

-- AddForeignKey
ALTER TABLE "FacialPhotoSubmission" ADD CONSTRAINT "FacialPhotoSubmission_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacialPhotoSubmission" ADD CONSTRAINT "FacialPhotoSubmission_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacialPhotoSubmission" ADD CONSTRAINT "FacialPhotoSubmission_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacialPhotoSubmission" ADD CONSTRAINT "FacialPhotoSubmission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
