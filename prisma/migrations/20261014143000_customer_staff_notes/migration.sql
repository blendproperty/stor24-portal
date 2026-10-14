CREATE TABLE "CustomerNote" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerNote_category_check" CHECK ("category" IN ('GENERAL', 'CALL', 'CUSTOMER_MESSAGE', 'PAYMENT_FOLLOW_UP', 'MOVE_IN', 'MOVE_OUT', 'COMPLAINT', 'HANDOVER')),
  CONSTRAINT "CustomerNote_body_check" CHECK (length(trim("body")) BETWEEN 1 AND 5000)
);
CREATE UNIQUE INDEX "CustomerNote_customerId_requestKey_key" ON "CustomerNote"("customerId", "requestKey");
CREATE INDEX "CustomerNote_organisationId_customerId_createdAt_id_idx" ON "CustomerNote"("organisationId", "customerId", "createdAt", "id");
CREATE INDEX "CustomerNote_customerId_facilityId_createdAt_id_idx" ON "CustomerNote"("customerId", "facilityId", "createdAt", "id");
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
