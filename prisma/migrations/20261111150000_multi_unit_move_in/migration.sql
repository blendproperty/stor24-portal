CREATE TABLE "MultiUnitMoveIn" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MultiUnitMoveIn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MultiUnitMoveIn_organisationId_requestKey_key" ON "MultiUnitMoveIn"("organisationId", "requestKey");
CREATE TABLE "MultiUnitMoveInItem" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "unitNumber" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "tenancyId" TEXT NOT NULL,
  CONSTRAINT "MultiUnitMoveInItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MultiUnitMoveInItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MultiUnitMoveIn"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MultiUnitMoveInItem_batchId_unitId_key" ON "MultiUnitMoveInItem"("batchId", "unitId");
