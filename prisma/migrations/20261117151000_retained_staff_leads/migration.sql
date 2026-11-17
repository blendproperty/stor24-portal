CREATE OR REPLACE FUNCTION public."stor24_staff_ref_lead"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN concat_ws(' ', CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."enquiryLocation" IS DISTINCT FROM OLD."enquiryLocation" THEN NEW."enquiryLocation"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."businessDetails" IS DISTINCT FROM OLD."businessDetails" THEN NEW."businessDetails"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."assignedToId" IS DISTINCT FROM OLD."assignedToId" THEN NEW."assignedToId"::text END)) > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
