CREATE TABLE "HikCentralAccessApproval" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "photoVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HikCentralAccessApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HikCentralAccessApproval_customerId_facilityId_key" ON "HikCentralAccessApproval"("customerId", "facilityId");
CREATE INDEX "HikCentralAccessApproval_organisationId_facilityId_expiresAt_idx" ON "HikCentralAccessApproval"("organisationId", "facilityId", "expiresAt");
ALTER TABLE "HikCentralAccessApproval" ADD CONSTRAINT "HikCentralAccessApproval_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION public."stor24_staff_ref_hikcentralaccessapproval"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN NEW."approvedById") > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "approvedById" ON public."HikCentralAccessApproval" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "approvedById" ON public."HikCentralAccessApproval" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_hikcentralaccessapproval"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_hikcentralaccessapproval"() FROM PUBLIC;

CREATE TABLE "HikCentralAccessLock" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "lockedById" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3),
    "unlockedById" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HikCentralAccessLock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HikCentralAccessLock_customerId_facilityId_key" ON "HikCentralAccessLock"("customerId", "facilityId");
CREATE INDEX "HikCentralAccessLock_organisationId_facilityId_lockedAt_idx" ON "HikCentralAccessLock"("organisationId", "facilityId", "lockedAt");
ALTER TABLE "HikCentralAccessLock" ADD CONSTRAINT "HikCentralAccessLock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION public."stor24_staff_ref_hikcentralaccesslock"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN NEW."lockedById") > 0 OR position(deleted."id" IN COALESCE(NEW."unlockedById", '')) > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "lockedById", "unlockedById" ON public."HikCentralAccessLock" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "lockedById", "unlockedById" ON public."HikCentralAccessLock" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_hikcentralaccesslock"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_hikcentralaccesslock"() FROM PUBLIC;
