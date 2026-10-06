ALTER TABLE "Unit" ADD COLUMN "combinedIntoUnitId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "combinationSnapshot" JSONB;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_combined_component_unavailable" CHECK ("combinedIntoUnitId" IS NULL OR ("status" = 'UNAVAILABLE' AND "combinedIntoUnitId" <> "id"));
CREATE INDEX "Unit_combinedIntoUnitId_idx" ON "Unit"("combinedIntoUnitId");
