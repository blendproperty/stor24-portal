BEGIN;
CREATE FUNCTION public.stor24_reset_active_user_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public."User" WHERE "id" = NEW."userId" AND "organisationId" = NEW."organisationId" AND "active" = true AND "retiredAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reset tokens require an active account.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reset_active_user_guard BEFORE INSERT OR UPDATE OF "userId", "organisationId" ON public."PasswordResetToken" FOR EACH ROW EXECUTE FUNCTION public.stor24_reset_active_user_guard();
REVOKE ALL ON FUNCTION public.stor24_reset_active_user_guard() FROM PUBLIC;
COMMIT;
