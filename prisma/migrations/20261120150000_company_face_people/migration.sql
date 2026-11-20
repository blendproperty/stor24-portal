ALTER TABLE "Customer" ADD COLUMN "accessCompanyId" TEXT;
CREATE INDEX "Customer_accessCompanyId_idx" ON "Customer"("accessCompanyId");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_accessCompanyId_fkey" FOREIGN KEY ("accessCompanyId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
