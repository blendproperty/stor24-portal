ALTER TABLE "PublicReservationLease"
  ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CARD',
  ADD COLUMN "signedPdf" BYTEA,
  ADD COLUMN "signedPdfSha256" TEXT;

