-- Operational policy is independent of unit occupancy / maintenance status.
ALTER TABLE "Facility" ADD COLUMN "closedFloors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
