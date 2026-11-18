CREATE TABLE "HikCentralFaceCapture" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'WAITING_REVIEW',
  "encryptedImage" TEXT,
  "imageSha256" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "consentNotice" TEXT NOT NULL,
  "consentAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "transferStartedAt" TIMESTAMP(3),
  "providerAcceptedAt" TIMESTAMP(3),
  "erasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HikCentralFaceCapture_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HikCentralFaceCapture_version_check" CHECK ("version" > 0),
  CONSTRAINT "HikCentralFaceCapture_status_check" CHECK ("status" IN ('WAITING_REVIEW','SENDING','PROVIDER_ACCEPTED','PROVIDER_UNCERTAIN','REJECTED','WITHDRAWN','EXPIRED')),
  CONSTRAINT "HikCentralFaceCapture_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HikCentralFaceCapture_customerId_key" ON "HikCentralFaceCapture"("customerId");
CREATE INDEX "HikCentralFaceCapture_status_expiresAt_idx" ON "HikCentralFaceCapture"("status", "expiresAt");

CREATE TABLE "HikCentralFaceHandoff" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "photoVersion" INTEGER NOT NULL,
  "issuedById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HikCentralFaceHandoff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HikCentralFaceHandoff_tokenHash_key" ON "HikCentralFaceHandoff"("tokenHash");
CREATE INDEX "HikCentralFaceHandoff_customerId_expiresAt_idx" ON "HikCentralFaceHandoff"("customerId", "expiresAt");

CREATE FUNCTION public."stor24_staff_ref_hikcentralfacehandoff"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN NEW."issuedById") > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "issuedById" ON public."HikCentralFaceHandoff" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "issuedById" ON public."HikCentralFaceHandoff" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_hikcentralfacehandoff"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_hikcentralfacehandoff"() FROM PUBLIC;
