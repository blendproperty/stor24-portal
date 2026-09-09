ALTER TABLE "Product" ADD COLUMN "quantityReserved" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "StoragePackage" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "badge" TEXT,
  "sellingPrice" DECIMAL(14,2) NOT NULL,
  "minUnitAreaSqM" DECIMAL(8,2),
  "maxUnitAreaSqM" DECIMAL(8,2),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoragePackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoragePackageItem" (
  "id" TEXT NOT NULL,
  "storagePackageId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoragePackageItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservationPackage" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "storagePackageId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "packageCode" TEXT NOT NULL,
  "packageName" TEXT NOT NULL,
  "priceSnapshot" DECIMAL(14,2) NOT NULL,
  "itemsSnapshot" JSONB NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoragePackage_facilityId_code_key" ON "StoragePackage"("facilityId", "code");
CREATE INDEX "StoragePackage_organisationId_facilityId_active_sortOrder_idx" ON "StoragePackage"("organisationId", "facilityId", "active", "sortOrder");
CREATE UNIQUE INDEX "StoragePackageItem_storagePackageId_productId_key" ON "StoragePackageItem"("storagePackageId", "productId");
CREATE INDEX "StoragePackageItem_productId_idx" ON "StoragePackageItem"("productId");
CREATE UNIQUE INDEX "ReservationPackage_reservationId_key" ON "ReservationPackage"("reservationId");
CREATE INDEX "ReservationPackage_storagePackageId_status_idx" ON "ReservationPackage"("storagePackageId", "status");

ALTER TABLE "StoragePackage" ADD CONSTRAINT "StoragePackage_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoragePackage" ADD CONSTRAINT "StoragePackage_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoragePackageItem" ADD CONSTRAINT "StoragePackageItem_storagePackageId_fkey" FOREIGN KEY ("storagePackageId") REFERENCES "StoragePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoragePackageItem" ADD CONSTRAINT "StoragePackageItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationPackage" ADD CONSTRAINT "ReservationPackage_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationPackage" ADD CONSTRAINT "ReservationPackage_storagePackageId_fkey" FOREIGN KEY ("storagePackageId") REFERENCES "StoragePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
