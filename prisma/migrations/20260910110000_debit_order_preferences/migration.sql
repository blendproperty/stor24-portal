ALTER TABLE "PublicReservationLease"
ADD COLUMN "debitOrderPreferences" JSONB,
ADD COLUMN "debitOrderRequestedAt" TIMESTAMP(3);
