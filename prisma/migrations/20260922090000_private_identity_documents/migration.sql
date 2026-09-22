ALTER TABLE "Reservation" ADD COLUMN "identityAccessHash" TEXT, ADD COLUMN "identityAccessExpiresAt" TIMESTAMP(3);
CREATE TABLE "IdentityDocument" (
 "id" TEXT NOT NULL PRIMARY KEY, "reservationId" TEXT NOT NULL UNIQUE,
 "version" INTEGER NOT NULL, "status" TEXT NOT NULL, "documentType" TEXT NOT NULL, "pageCount" INTEGER NOT NULL,
 "encryptedPages" TEXT, "policyHash" TEXT NOT NULL, "policySnapshot" TEXT NOT NULL,
 "acknowledgedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "reviewedAt" TIMESTAMP(3), "reviewedById" TEXT, "replacementReason" TEXT, "erasedAt" TIMESTAMP(3),
 CONSTRAINT "IdentityDocument_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "IdentityDocument_expiresAt_status_idx" ON "IdentityDocument"("expiresAt", "status");
CREATE TABLE "IdentityDocumentMaintenance" ("id" TEXT NOT NULL PRIMARY KEY, "completedAt" TIMESTAMP(3) NOT NULL);
