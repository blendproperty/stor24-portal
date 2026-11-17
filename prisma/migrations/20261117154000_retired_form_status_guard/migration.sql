BEGIN;
CREATE OR REPLACE FUNCTION public.stor24_retired_task_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."status" NOT IN ('COMPLETED', 'CANCELLED') AND EXISTS (
    SELECT 1 FROM public."DeletedStaffIdentity" deleted
    WHERE deleted."id" IN (NEW."assigneeId", NEW."coverId")
      OR (NEW."purpose" = 'OPERATIONAL_FORM' AND NEW."assigneeId" IS NULL AND deleted."id" = NEW."createdById")
      OR (NEW."purpose" = 'OPERATIONAL_FORM' AND deleted."id" = NEW."operationalForm" ->> 'reviewerId')
      OR (NEW."purpose" = 'OPERATIONAL_CHECKLIST' AND deleted."id" = NEW."operationalChecklist" ->> 'reviewerId')
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reassign work before reopening it.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER retired_task_status_fence ON public."Task";
DROP TRIGGER retired_task_status_guard ON public."Task";
CREATE TRIGGER retired_task_status_fence BEFORE UPDATE OF "status", "purpose" ON public."Task" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER retired_task_status_guard BEFORE UPDATE OF "status", "purpose" ON public."Task" FOR EACH ROW EXECUTE FUNCTION public.stor24_retired_task_status_guard();
COMMIT;
