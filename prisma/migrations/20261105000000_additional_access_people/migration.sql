CREATE TABLE "AdditionalAccessPerson" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOMINATED',
    "photoVersion" INTEGER NOT NULL DEFAULT 0,
    "encryptedImage" TEXT,
    "imageSha256" TEXT,
    "policyVersion" TEXT,
    "policyHash" TEXT,
    "consentNotice" TEXT,
    "consentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdditionalAccessPerson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdditionalAccessPerson_reservationId_status_idx" ON "AdditionalAccessPerson"("reservationId", "status");
ALTER TABLE "AdditionalAccessPerson" ADD CONSTRAINT "AdditionalAccessPerson_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
