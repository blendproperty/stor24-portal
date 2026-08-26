ALTER TABLE "Customer"
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "Reservation"
ADD COLUMN "verificationCodeHash" TEXT,
ADD COLUMN "verificationExpiresAt" TIMESTAMP(3),
ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contactVerifiedAt" TIMESTAMP(3);

CREATE INDEX "Reservation_status_verificationExpiresAt_idx"
ON "Reservation"("status", "verificationExpiresAt");
