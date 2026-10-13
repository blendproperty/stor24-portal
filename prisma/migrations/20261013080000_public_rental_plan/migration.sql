ALTER TABLE "Reservation" ADD COLUMN "rentalPlan" JSONB;
ALTER TABLE "PublicDebitMandate" ADD COLUMN "invitationSentAt" TIMESTAMP(3), ADD COLUMN "invitationAttemptAt" TIMESTAMP(3), ADD COLUMN "invitationFailed" BOOLEAN NOT NULL DEFAULT false;
