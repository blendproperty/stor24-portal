CREATE TYPE "ReservationJourney" AS ENUM ('RENTAL', 'VIEWING');

ALTER TABLE "Reservation"
ADD COLUMN "journey" "ReservationJourney" NOT NULL DEFAULT 'RENTAL',
ADD COLUMN "viewingAt" TIMESTAMP(3);

CREATE INDEX "Reservation_journey_viewingAt_idx"
ON "Reservation"("journey", "viewingAt");
