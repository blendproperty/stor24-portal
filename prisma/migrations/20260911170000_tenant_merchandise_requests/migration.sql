CREATE TABLE "TenantMerchandiseRequest" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "unitKey" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantMerchandiseRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantMerchandiseRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TenantMerchandiseRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TenantMerchandiseRequest_taskId_key" ON "TenantMerchandiseRequest"("taskId");
CREATE UNIQUE INDEX "TenantMerchandiseRequest_customerId_idempotencyKey_key" ON "TenantMerchandiseRequest"("customerId", "idempotencyKey");
CREATE INDEX "TenantMerchandiseRequest_customerId_unitKey_createdAt_idx" ON "TenantMerchandiseRequest"("customerId", "unitKey", "createdAt");
