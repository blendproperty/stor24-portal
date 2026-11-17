BEGIN;
-- Existing historical identities may remain in the same JSON fields; new occurrences remain forbidden.
CREATE OR REPLACE FUNCTION public.stor24_retained_json_added(previous jsonb, current jsonb, staff_id text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE item record;
BEGIN
  IF current IS NOT DISTINCT FROM previous OR current IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(current) = 'object' THEN
    FOR item IN SELECT key, value FROM jsonb_each(current) LOOP
      IF position(staff_id IN item.key) > 0 AND (NOT COALESCE(previous ? item.key, false) OR item.value IS DISTINCT FROM previous -> item.key) THEN RETURN true; END IF;
      IF public.stor24_retained_json_added(previous -> item.key, item.value, staff_id) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  ELSIF jsonb_typeof(current) = 'array' THEN
    FOR item IN SELECT value, ordinality FROM jsonb_array_elements(current) WITH ORDINALITY LOOP
      IF public.stor24_retained_json_added(previous -> (item.ordinality::integer - 1), item.value, staff_id) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;
  RETURN position(staff_id IN current::text) > 0;
END $$;
REVOKE ALL ON FUNCTION public.stor24_retained_json_added(jsonb, jsonb, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public."stor24_staff_ref_task"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE
    position(deleted."id" IN concat_ws(' ',
      CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId" THEN NEW."assigneeId"::text END,
      CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."createdById" IS DISTINCT FROM OLD."createdById" THEN NEW."createdById"::text END,
      CASE WHEN NOT deleted."retained" OR TG_OP = 'INSERT' OR NEW."coverId" IS DISTINCT FROM OLD."coverId" THEN NEW."coverId"::text END)) > 0
    OR (NOT deleted."retained" AND position(deleted."id" IN concat_ws(' ', NEW."operationalForm"::text, NEW."operationalChecklist"::text)) > 0)
    OR (deleted."retained" AND TG_OP = 'INSERT' AND position(deleted."id" IN concat_ws(' ', NEW."operationalForm"::text, NEW."operationalChecklist"::text)) > 0)
    OR (deleted."retained" AND TG_OP = 'UPDATE' AND (public.stor24_retained_json_added(OLD."operationalForm", NEW."operationalForm", deleted."id") OR public.stor24_retained_json_added(OLD."operationalChecklist", NEW."operationalChecklist", deleted."id")))
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.'; END IF;
  RETURN NEW;
END $$;
COMMIT;
