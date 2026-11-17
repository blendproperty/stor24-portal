BEGIN;

ALTER TABLE "User" ADD COLUMN "retiredAt" TIMESTAMP(3);

ALTER TABLE "DeletedStaffIdentity" ADD COLUMN "retained" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User" ADD CONSTRAINT "retired_user_no_access" CHECK ("retiredAt" IS NULL OR (NOT "active" AND "passwordHash" IS NULL));

CREATE OR REPLACE FUNCTION public."stor24_staff_ref_task"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN concat_ws(' ', CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."operationalForm" IS DISTINCT FROM OLD."operationalForm" THEN NEW."operationalForm"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."operationalChecklist" IS DISTINCT FROM OLD."operationalChecklist" THEN NEW."operationalChecklist"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId" THEN NEW."assigneeId"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."createdById" IS DISTINCT FROM OLD."createdById" THEN NEW."createdById"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."coverId" IS DISTINCT FROM OLD."coverId" THEN NEW."coverId"::text END)) > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public."stor24_staff_ref_reservationpriceamendment"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN concat_ws(' ', CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."proposedById" IS DISTINCT FROM OLD."proposedById" THEN NEW."proposedById"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."reviewedById" IS DISTINCT FROM OLD."reviewedById" THEN NEW."reviewedById"::text END)) > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public."stor24_staff_ref_priceapprovalchallenge"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN concat_ws(' ', CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById" THEN NEW."requestedById"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."approverId" IS DISTINCT FROM OLD."approverId" THEN NEW."approverId"::text END)) > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public."stor24_staff_ref_moveintrainingrun"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE position(deleted."id" IN concat_ws(' ', CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN NEW."userId"::text END, CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."state" IS DISTINCT FROM OLD."state" THEN NEW."state"::text END)) > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public."stor24_staff_ref_auditevent"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE
    position(deleted."id" IN concat_ws(' ',
      CASE WHEN TG_OP = 'INSERT' OR NEW."actorId" IS DISTINCT FROM OLD."actorId" THEN NEW."actorId"::text END,
      CASE WHEN NOT deleted."retained" AND (TG_OP = 'INSERT' OR NEW."before" IS DISTINCT FROM OLD."before") THEN NEW."before"::text END,
      CASE WHEN NOT deleted."retained" AND (TG_OP = 'INSERT' OR NEW."after" IS DISTINCT FROM OLD."after") THEN NEW."after"::text END)) > 0
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.stor24_retired_user_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD."retiredAt" IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A retained staff identity cannot be changed.'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER retired_user_guard BEFORE UPDATE OR DELETE ON public."User" FOR EACH ROW EXECUTE FUNCTION public.stor24_retired_user_guard();
REVOKE ALL ON FUNCTION public.stor24_retired_user_guard() FROM PUBLIC;
CREATE FUNCTION public.stor24_retired_role_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public."User" WHERE "id" = NEW."userId" AND "retiredAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A retained staff identity cannot receive access.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retired_role_guard BEFORE INSERT OR UPDATE OF "userId" ON public."RoleAssignment" FOR EACH ROW EXECUTE FUNCTION public.stor24_retired_role_guard();
REVOKE ALL ON FUNCTION public.stor24_retired_role_guard() FROM PUBLIC;
COMMIT;
