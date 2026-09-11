CREATE TABLE "MerchandiseOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "total" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "stockHeld" BOOLEAN NOT NULL DEFAULT true,
  "paymentId" TEXT REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "idempotencyKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchandiseOrder_positive_total" CHECK ("total" > 0),
  CONSTRAINT "MerchandiseOrder_status_valid" CHECK ("status" IN ('AWAITING_PAYMENT','PAID','PAYMENT_REVIEW','FULFILLED','CANCELLED','EXPIRED'))
);
CREATE UNIQUE INDEX "MerchandiseOrder_paymentId_key" ON "MerchandiseOrder"("paymentId");
CREATE UNIQUE INDEX "MerchandiseOrder_accountId_idempotencyKey_key" ON "MerchandiseOrder"("accountId", "idempotencyKey");
CREATE INDEX "MerchandiseOrder_organisationId_facilityId_status_expiresAt_idx" ON "MerchandiseOrder"("organisationId", "facilityId", "status", "expiresAt");
CREATE TABLE "MerchandiseOrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "MerchandiseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "unitPrice" DECIMAL(14,2) NOT NULL CHECK ("unitPrice" >= 0)
);
CREATE UNIQUE INDEX "MerchandiseOrderItem_orderId_productId_key" ON "MerchandiseOrderItem"("orderId", "productId");
