CREATE TABLE "PublicDebitMandate" (
  "id" TEXT NOT NULL, "leaseId" TEXT NOT NULL, "reference" TEXT NOT NULL,
  "correlation" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'CREATING',
  "terms" JSONB NOT NULL, "hostedUrl" TEXT, "reportToken" TEXT, "pdfToken" TEXT, "signedPdf" BYTEA, "signedPdfSha256" TEXT,
  "reportRequestedAt" TIMESTAMP(3), "lastCheckedAt" TIMESTAMP(3), "verifiedAt" TIMESTAMP(3),
  "failureCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PublicDebitMandate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicDebitMandate_leaseId_key" ON "PublicDebitMandate"("leaseId");
CREATE UNIQUE INDEX "PublicDebitMandate_reference_key" ON "PublicDebitMandate"("reference");
CREATE UNIQUE INDEX "PublicDebitMandate_correlation_key" ON "PublicDebitMandate"("correlation");
ALTER TABLE "PublicDebitMandate" ADD CONSTRAINT "PublicDebitMandate_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "PublicReservationLease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
