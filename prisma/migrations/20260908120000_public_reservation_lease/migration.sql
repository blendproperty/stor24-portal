CREATE TABLE "PublicReservationLease" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "clauses" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "signingToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "signerName" TEXT,
    "signerIp" TEXT,
    "signerUserAgent" TEXT,
    "initials" JSONB,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicReservationLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicReservationLease_reservationId_key" ON "PublicReservationLease"("reservationId");
CREATE UNIQUE INDEX "PublicReservationLease_signingToken_key" ON "PublicReservationLease"("signingToken");
CREATE INDEX "PublicReservationLease_status_expiresAt_idx" ON "PublicReservationLease"("status", "expiresAt");

ALTER TABLE "PublicReservationLease"
ADD CONSTRAINT "PublicReservationLease_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
