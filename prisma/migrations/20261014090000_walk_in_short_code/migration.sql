ALTER TABLE "WalkInVisit" ADD COLUMN "shortCodeHash" TEXT;
CREATE UNIQUE INDEX "WalkInVisit_shortCodeHash_key" ON "WalkInVisit"("shortCodeHash");
