-- Only booking-price separation of duties changes. Decision identity/time/reference remain mandatory.
ALTER TABLE "ReservationPriceAmendment" DROP CONSTRAINT "ReservationPriceAmendment_check";
ALTER TABLE "ReservationPriceAmendment" ADD CONSTRAINT "ReservationPriceAmendment_review_evidence_check"
 CHECK ("status" NOT IN ('APPROVED','APPLIED') OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReference" IS NOT NULL));
CREATE TABLE "PriceApprovalChallenge" (
 "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE CASCADE,
 "facilityId" TEXT NOT NULL REFERENCES "Facility"("id") ON DELETE CASCADE,
 "amendmentId" TEXT NOT NULL REFERENCES "ReservationPriceAmendment"("id") ON DELETE CASCADE,
 "revision" INTEGER NOT NULL, "quoteFingerprint" TEXT NOT NULL,
 "requestedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "approverId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "requesterSessionVersion" INTEGER NOT NULL, "requesterSessionHash" TEXT NOT NULL, "approverSessionVersion" INTEGER NOT NULL,
 "contactVersion" TEXT NOT NULL, "codeHash" TEXT NOT NULL, "reference" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
 "status" TEXT NOT NULL DEFAULT 'SENDING', "providerRef" TEXT, "consumedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PriceApprovalChallenge_organisationId_requestedById_createdAt_idx" ON "PriceApprovalChallenge"("organisationId","requestedById","createdAt");
CREATE INDEX "PriceApprovalChallenge_expiresAt_idx" ON "PriceApprovalChallenge"("expiresAt");
