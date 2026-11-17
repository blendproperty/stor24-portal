BEGIN;
CREATE FUNCTION public.stor24_retired_task_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."status" NOT IN ('COMPLETED', 'CANCELLED') AND EXISTS (
    SELECT 1 FROM public."DeletedStaffIdentity" deleted
    WHERE deleted."id" IN (NEW."assigneeId", NEW."coverId")
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reassign work before reopening it.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retired_task_status_fence BEFORE UPDATE OF "status" ON public."Task" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER retired_task_status_guard BEFORE UPDATE OF "status" ON public."Task" FOR EACH ROW EXECUTE FUNCTION public.stor24_retired_task_status_guard();
REVOKE ALL ON FUNCTION public.stor24_retired_task_status_guard() FROM PUBLIC;

CREATE FUNCTION public.stor24_retired_lead_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."stage" <> 'LOST' AND EXISTS (
    SELECT 1 FROM public."DeletedStaffIdentity" deleted WHERE deleted."id" = NEW."assignedToId"
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reassign the enquiry before reopening it.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retired_lead_status_fence BEFORE UPDATE OF "stage" ON public."Lead" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER retired_lead_status_guard BEFORE UPDATE OF "stage" ON public."Lead" FOR EACH ROW EXECUTE FUNCTION public.stor24_retired_lead_status_guard();
REVOKE ALL ON FUNCTION public.stor24_retired_lead_status_guard() FROM PUBLIC;
COMMIT;
