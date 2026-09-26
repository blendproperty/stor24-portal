ALTER TABLE "StockMovement" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");
