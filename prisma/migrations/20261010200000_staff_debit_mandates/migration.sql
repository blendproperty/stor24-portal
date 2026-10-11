CREATE TABLE "DebitMandateSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenancyId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "signingToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "monthlyRate" DECIMAL(12,2) NOT NULL,
  "source" JSONB NOT NULL,
  "preferences" JSONB,
  "requestedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DebitMandateSession_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DebitMandateSession_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DebitMandateSession_tenancyId_key" ON "DebitMandateSession"("tenancyId");
CREATE UNIQUE INDEX "DebitMandateSession_documentId_key" ON "DebitMandateSession"("documentId");
CREATE UNIQUE INDEX "DebitMandateSession_signingToken_key" ON "DebitMandateSession"("signingToken");
ALTER TABLE "PublicDebitMandate" ALTER COLUMN "leaseId" DROP NOT NULL;
ALTER TABLE "PublicDebitMandate" ADD COLUMN "sessionId" TEXT;
CREATE UNIQUE INDEX "PublicDebitMandate_sessionId_key" ON "PublicDebitMandate"("sessionId");
ALTER TABLE "PublicDebitMandate" ADD CONSTRAINT "PublicDebitMandate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DebitMandateSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicDebitMandate" ADD CONSTRAINT "PublicDebitMandate_one_source" CHECK (("leaseId" IS NOT NULL)::int + ("sessionId" IS NOT NULL)::int = 1);
