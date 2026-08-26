CREATE TABLE "PublicPaymentSession" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'STOR24_SIMULATOR',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "description" TEXT NOT NULL,
    "checkoutTokenHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "failureCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicPaymentSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicPaymentSession_idempotencyKey_key" ON "PublicPaymentSession"("idempotencyKey");
CREATE UNIQUE INDEX "PublicPaymentSession_providerReference_key" ON "PublicPaymentSession"("providerReference");
CREATE INDEX "PublicPaymentSession_reservationId_status_idx" ON "PublicPaymentSession"("reservationId", "status");
CREATE INDEX "PublicPaymentSession_status_expiresAt_idx" ON "PublicPaymentSession"("status", "expiresAt");
ALTER TABLE "PublicPaymentSession" ADD CONSTRAINT "PublicPaymentSession_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
