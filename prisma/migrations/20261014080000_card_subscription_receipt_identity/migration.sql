-- Nullable additions preserve existing once-off payments and their unique reference.
-- A recurring receipt has its own trace identity while retaining the original
-- provider subscription reference separately; do not fabricate providerRef.
ALTER TABLE "Payment" ADD COLUMN "providerOriginalRef" TEXT;
ALTER TABLE "Payment" ADD COLUMN "providerRequestTraceHash" TEXT;
ALTER TABLE "Payment" ADD COLUMN "providerFacilityId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "providerOrganisationId" TEXT;
CREATE UNIQUE INDEX "Payment_providerRequestTraceHash_key" ON "Payment"("providerRequestTraceHash");
CREATE INDEX "Payment_providerOrganisationId_providerFacilityId_createdAt_idx" ON "Payment"("providerOrganisationId", "providerFacilityId", "createdAt");
