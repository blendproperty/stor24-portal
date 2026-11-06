CREATE TABLE "CombinedInvoiceMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CombinedInvoiceMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CombinedInvoiceMembership_accountId_period_key" ON "CombinedInvoiceMembership"("accountId", "period");
CREATE INDEX "CombinedInvoiceMembership_documentId_idx" ON "CombinedInvoiceMembership"("documentId");
ALTER TABLE "CombinedInvoiceMembership" ADD CONSTRAINT "CombinedInvoiceMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinedInvoiceMembership" ADD CONSTRAINT "CombinedInvoiceMembership_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
