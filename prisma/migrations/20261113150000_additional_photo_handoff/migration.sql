CREATE TABLE "AdditionalPhotoHandoff" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "photoVersion" INTEGER NOT NULL,
  "issuedById" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdditionalPhotoHandoff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdditionalPhotoHandoff_tokenHash_key" ON "AdditionalPhotoHandoff"("tokenHash");
CREATE INDEX "AdditionalPhotoHandoff_personId_expiresAt_idx" ON "AdditionalPhotoHandoff"("personId", "expiresAt");

CREATE FUNCTION public."stor24_staff_ref_additionalphotohandoff"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN NEW."issuedById") > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "issuedById" ON public."AdditionalPhotoHandoff" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "issuedById" ON public."AdditionalPhotoHandoff" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_additionalphotohandoff"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_additionalphotohandoff"() FROM PUBLIC;
