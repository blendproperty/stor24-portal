CREATE TABLE "ReservationPriceAmendment" (
 "id" TEXT NOT NULL PRIMARY KEY, "organisationId" TEXT NOT NULL, "facilityId" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
 "sourceFingerprint" TEXT NOT NULL, "quoteFingerprint" TEXT NOT NULL,
 "originalEncrypted" TEXT NOT NULL, "proposedEncrypted" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "proposedById" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PROPOSED' CHECK ("status" IN ('PROPOSED','APPROVED','REJECTED','WITHDRAWN','APPLIED')),
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0), "expiresAt" TIMESTAMP(3) NOT NULL,
 "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "reviewReference" TEXT,
 "acceptedCustomerId" TEXT, "acceptedAt" TIMESTAMP(3), "acceptanceFingerprint" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("status" NOT IN ('APPROVED','APPLIED') OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReference" IS NOT NULL AND "reviewedById"<>"proposedById")),
 CHECK ("status"<>'APPLIED' OR ("acceptedCustomerId" IS NOT NULL AND "acceptedAt" IS NOT NULL AND "acceptanceFingerprint"="quoteFingerprint"))
);
CREATE UNIQUE INDEX "ReservationPriceAmendment_organisationId_requestKey_key" ON "ReservationPriceAmendment"("organisationId","requestKey");
CREATE UNIQUE INDEX "ReservationPriceAmendment_one_pending" ON "ReservationPriceAmendment"("organisationId","reservationId") WHERE "status" IN ('PROPOSED','APPROVED');
CREATE INDEX "ReservationPriceAmendment_org_store_created_idx" ON "ReservationPriceAmendment"("organisationId","facilityId","createdAt","id");
CREATE INDEX "ReservationPriceAmendment_reservationId_status_idx" ON "ReservationPriceAmendment"("reservationId","status");
CREATE FUNCTION reservation_price_original_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."id",NEW."organisationId",NEW."facilityId",NEW."reservationId",NEW."sourceFingerprint",NEW."quoteFingerprint",NEW."originalEncrypted",NEW."proposedEncrypted",NEW."requestKey",NEW."requestHash",NEW."proposedById",NEW."expiresAt",NEW."createdAt")
 IS DISTINCT FROM ROW(OLD."id",OLD."organisationId",OLD."facilityId",OLD."reservationId",OLD."sourceFingerprint",OLD."quoteFingerprint",OLD."originalEncrypted",OLD."proposedEncrypted",OLD."requestKey",OLD."requestHash",OLD."proposedById",OLD."expiresAt",OLD."createdAt") THEN
  RAISE EXCEPTION 'Original booking quote and proposed terms are immutable';
 END IF;
 IF OLD."status" IN ('REJECTED','WITHDRAWN','APPLIED') THEN RAISE EXCEPTION 'Terminal booking price evidence is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_price_original_immutable BEFORE UPDATE ON "ReservationPriceAmendment" FOR EACH ROW EXECUTE FUNCTION reservation_price_original_immutable();
