BEGIN;
CREATE OR REPLACE FUNCTION public."stor24_staff_ref_auditevent"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."DeletedStaffIdentity" deleted
    WHERE position(deleted."id" IN concat_ws(' ',
      CASE WHEN TG_OP = 'INSERT' OR NEW."actorId" IS DISTINCT FROM OLD."actorId" THEN NEW."actorId"::text END,
      CASE WHEN TG_OP = 'INSERT' OR NEW."before" IS DISTINCT FROM OLD."before" THEN NEW."before"::text END,
      CASE WHEN TG_OP = 'INSERT' OR NEW."after" IS DISTINCT FROM OLD."after" THEN NEW."after"::text END)) > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public."stor24_staff_ref_auditevent"() FROM PUBLIC;
COMMIT;
