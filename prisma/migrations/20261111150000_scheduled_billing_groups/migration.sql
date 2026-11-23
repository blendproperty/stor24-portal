DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ScheduledBillingCharge" WHERE "invoiceId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Existing staged invoices require explicit reconciliation before group migration';
  END IF;
END $$;
DROP INDEX "ScheduledBillingCharge_invoiceId_key";
ALTER TABLE "ScheduledBillingCharge" ADD COLUMN "lineType" TEXT NOT NULL DEFAULT 'CHARGE', ADD COLUMN "groupSize" INTEGER, ADD COLUMN "groupHash" TEXT;
ALTER TABLE "ScheduledBillingCharge" ADD CONSTRAINT "ScheduledBillingCharge_lineType_check" CHECK ("lineType" IN ('CHARGE', 'CREDIT'));
ALTER TABLE "ScheduledBillingCharge" ADD CONSTRAINT "ScheduledBillingCharge_group_check" CHECK (("invoiceId" IS NULL AND "groupSize" IS NULL AND "groupHash" IS NULL) OR ("invoiceId" IS NOT NULL AND "groupSize" IS NOT NULL AND "groupSize" > 0 AND "groupHash" IS NOT NULL));
CREATE INDEX "ScheduledBillingCharge_invoiceId_idx" ON "ScheduledBillingCharge"("invoiceId");

