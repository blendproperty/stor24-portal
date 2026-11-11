ALTER TABLE "ScheduledBillingCharge" ADD COLUMN "invoiceId" TEXT;
CREATE UNIQUE INDEX "ScheduledBillingCharge_invoiceId_key" ON "ScheduledBillingCharge"("invoiceId");
ALTER TABLE "ScheduledBillingCharge" ADD CONSTRAINT "ScheduledBillingCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
