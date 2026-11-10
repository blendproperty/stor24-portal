BEGIN;
SET LOCAL lock_timeout = '3s';

-- The opaque identifier remains only to prevent a stale in-flight writer from
-- creating a new reference after the account has been deleted.
CREATE TABLE "DeletedStaffIdentity" ("id" TEXT PRIMARY KEY);
CREATE TABLE "StaffDeletionFence" ("id" INTEGER PRIMARY KEY, "generation" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "staff_deletion_fence_singleton" CHECK ("id" = 1));
INSERT INTO "StaffDeletionFence" ("id") VALUES (1);

-- All supported staff-reference writes take the shared fence before row locks.
-- A delete takes the exclusive fence before checking dependencies. The row lock
-- forces a pre-existing repeatable-read snapshot to abort rather than miss a tombstone.
CREATE FUNCTION public.stor24_staff_reference_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(143, 2441);
  PERFORM "generation" FROM public."StaffDeletionFence" WHERE "id" = 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff deletion fence unavailable'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.stor24_staff_reference_statement() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_facility"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."address"::text, NEW."closedFloors"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "address", "closedFloors" ON public."Facility" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "address", "closedFloors" ON public."Facility" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_facility"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_facility"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_unittype"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."businessAttributes"::text, NEW."useTypes"::text, NEW."features"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "businessAttributes", "useTypes", "features" ON public."UnitType" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "businessAttributes", "useTypes", "features" ON public."UnitType" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_unittype"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_unittype"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_unit"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."combinationSnapshot"::text, NEW."businessAttributesOverride"::text, NEW."useTypesOverride"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "combinationSnapshot", "businessAttributesOverride", "useTypesOverride" ON public."Unit" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "combinationSnapshot", "businessAttributesOverride", "useTypesOverride" ON public."Unit" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_unit"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_unit"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_mapelement"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."config"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "config" ON public."MapElement" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "config" ON public."MapElement" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_mapelement"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_mapelement"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_customer"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."billingAddress"::text, NEW."emergencyContact"::text, NEW."alternateContact"::text, NEW."workContact"::text, NEW."communicationConsent"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "billingAddress", "emergencyContact", "alternateContact", "workContact", "communicationConsent" ON public."Customer" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "billingAddress", "emergencyContact", "alternateContact", "workContact", "communicationConsent" ON public."Customer" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_customer"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_customer"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_lead"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."enquiryLocation"::text, NEW."businessDetails"::text, NEW."assignedToId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "enquiryLocation", "businessDetails", "assignedToId" ON public."Lead" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "enquiryLocation", "businessDetails", "assignedToId" ON public."Lead" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_lead"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_lead"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_reservationpriceamendment"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."proposedById"::text, NEW."reviewedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "proposedById", "reviewedById" ON public."ReservationPriceAmendment" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "proposedById", "reviewedById" ON public."ReservationPriceAmendment" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_reservationpriceamendment"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_reservationpriceamendment"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_reservation"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."businessDetails"::text, NEW."initialRentSnapshot"::text, NEW."rentalPlan"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "businessDetails", "initialRentSnapshot", "rentalPlan" ON public."Reservation" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "businessDetails", "initialRentSnapshot", "rentalPlan" ON public."Reservation" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_reservation"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_reservation"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_publicreservationlease"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."clauses"::text, NEW."initials"::text, NEW."debitOrderPreferences"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "clauses", "initials", "debitOrderPreferences" ON public."PublicReservationLease" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "clauses", "initials", "debitOrderPreferences" ON public."PublicReservationLease" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_publicreservationlease"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_publicreservationlease"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_publicdebitmandate"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."terms"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "terms" ON public."PublicDebitMandate" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "terms" ON public."PublicDebitMandate" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_publicdebitmandate"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_publicdebitmandate"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_debitmandatesession"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."source"::text, NEW."preferences"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "source", "preferences" ON public."DebitMandateSession" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "source", "preferences" ON public."DebitMandateSession" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_debitmandatesession"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_debitmandatesession"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_tenancy"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."businessDetails"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "businessDetails" ON public."Tenancy" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "businessDetails" ON public."Tenancy" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_tenancy"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_tenancy"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_biometricenrollment"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."consentRecordedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "consentRecordedById" ON public."BiometricEnrollment" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "consentRecordedById" ON public."BiometricEnrollment" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_biometricenrollment"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_biometricenrollment"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_integrationidentitylink"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."resolvedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "resolvedById" ON public."IntegrationIdentityLink" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "resolvedById" ON public."IntegrationIdentityLink" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_integrationidentitylink"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_integrationidentitylink"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_accessdecision"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."requestedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "requestedById" ON public."AccessDecision" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "requestedById" ON public."AccessDecision" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_accessdecision"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_accessdecision"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_insuranceenrollment"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."createdById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "createdById" ON public."InsuranceEnrollment" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "createdById" ON public."InsuranceEnrollment" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_insuranceenrollment"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_insuranceenrollment"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_facialphotosubmission"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."reviewedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."FacialPhotoSubmission" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."FacialPhotoSubmission" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_facialphotosubmission"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_facialphotosubmission"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_legacyaccessphoto"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."reviewedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."LegacyAccessPhoto" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."LegacyAccessPhoto" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_legacyaccessphoto"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_legacyaccessphoto"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_additionalaccessperson"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."reviewedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."AdditionalAccessPerson" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."AdditionalAccessPerson" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_additionalaccessperson"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_additionalaccessperson"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_collectioncase"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."ownerId"::text, NEW."terms"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "ownerId", "terms" ON public."CollectionCase" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "ownerId", "terms" ON public."CollectionCase" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_collectioncase"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_collectioncase"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_collectionactivity"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."actorId"::text, NEW."payload"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "actorId", "payload" ON public."CollectionActivity" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "actorId", "payload" ON public."CollectionActivity" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_collectionactivity"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_collectionactivity"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_collectionpromise"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."createdById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "createdById" ON public."CollectionPromise" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "createdById" ON public."CollectionPromise" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_collectionpromise"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_collectionpromise"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_receiptreallocation"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."snapshot"::text, NEW."requestedById"::text, NEW."reviewedById"::text, NEW."postedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "snapshot", "requestedById", "reviewedById", "postedById" ON public."ReceiptReallocation" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "snapshot", "requestedById", "reviewedById", "postedById" ON public."ReceiptReallocation" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_receiptreallocation"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_receiptreallocation"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_financialadjustment"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."snapshot"::text, NEW."requestedById"::text, NEW."reviewedById"::text, NEW."postedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "snapshot", "requestedById", "reviewedById", "postedById" ON public."FinancialAdjustment" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "snapshot", "requestedById", "reviewedById", "postedById" ON public."FinancialAdjustment" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_financialadjustment"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_financialadjustment"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_debitorderrun"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."snapshot"::text, NEW."createdById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "snapshot", "createdById" ON public."DebitOrderRun" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "snapshot", "createdById" ON public."DebitOrderRun" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_debitorderrun"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_debitorderrun"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_ledgerentry"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."metadata"::text, NEW."createdById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "metadata", "createdById" ON public."LedgerEntry" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "metadata", "createdById" ON public."LedgerEntry" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_ledgerentry"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_ledgerentry"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_settlementstatement"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."importedById"::text, NEW."editedById"::text, NEW."approvedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "importedById", "editedById", "approvedById" ON public."SettlementStatement" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "importedById", "editedById", "approvedById" ON public."SettlementStatement" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_settlementstatement"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_settlementstatement"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_settlementline"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."extras"::text, NEW."resolutionSnapshot"::text, NEW."resolvedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "extras", "resolutionSnapshot", "resolvedById" ON public."SettlementLine" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "extras", "resolutionSnapshot", "resolvedById" ON public."SettlementLine" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_settlementline"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_settlementline"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_settlementbankimport"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."importedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "importedById" ON public."SettlementBankImport" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "importedById" ON public."SettlementBankImport" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_settlementbankimport"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_settlementbankimport"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_settlementbalanceobservation"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."recordedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "recordedById" ON public."SettlementBalanceObservation" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "recordedById" ON public."SettlementBalanceObservation" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_settlementbalanceobservation"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_settlementbalanceobservation"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_document"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."initials"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "initials" ON public."Document" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "initials" ON public."Document" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_document"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_document"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_tenantportalchallenge"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."customerIds"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "customerIds" ON public."TenantPortalChallenge" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "customerIds" ON public."TenantPortalChallenge" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_tenantportalchallenge"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_tenantportalchallenge"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_tenantportalsession"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."customerIds"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "customerIds" ON public."TenantPortalSession" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "customerIds" ON public."TenantPortalSession" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_tenantportalsession"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_tenantportalsession"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_role"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."permissions"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "permissions" ON public."Role" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "permissions" ON public."Role" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_role"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_role"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_task"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."operationalForm"::text, NEW."operationalChecklist"::text, NEW."assigneeId"::text, NEW."createdById"::text, NEW."coverId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "operationalForm", "operationalChecklist", "assigneeId", "createdById", "coverId" ON public."Task" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "operationalForm", "operationalChecklist", "assigneeId", "createdById", "coverId" ON public."Task" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_task"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_task"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_staffoperationalacknowledgement"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."userId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "userId" ON public."StaffOperationalAcknowledgement" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "userId" ON public."StaffOperationalAcknowledgement" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_staffoperationalacknowledgement"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_staffoperationalacknowledgement"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_arrivalhandover"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."ownerId"::text, NEW."coverId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "ownerId", "coverId" ON public."ArrivalHandover" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "ownerId", "coverId" ON public."ArrivalHandover" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_arrivalhandover"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_arrivalhandover"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_integrationconnection"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."config"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "config" ON public."IntegrationConnection" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "config" ON public."IntegrationConnection" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_integrationconnection"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_integrationconnection"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_configurationprofile"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."config"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "config" ON public."ConfigurationProfile" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "config" ON public."ConfigurationProfile" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_configurationprofile"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_configurationprofile"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_chargedefinition"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."config"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "config" ON public."ChargeDefinition" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "config" ON public."ChargeDefinition" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_chargedefinition"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_chargedefinition"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_discountplan"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."rules"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "rules" ON public."DiscountPlan" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "rules" ON public."DiscountPlan" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_discountplan"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_discountplan"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_unitnote"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."authorId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "authorId" ON public."UnitNote" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "authorId" ON public."UnitNote" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_unitnote"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_unitnote"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_maintenancerequest"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."assignedToId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "assignedToId" ON public."MaintenanceRequest" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "assignedToId" ON public."MaintenanceRequest" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_maintenancerequest"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_maintenancerequest"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_tenantmerchandiserequest"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."items"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "items" ON public."TenantMerchandiseRequest" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "items" ON public."TenantMerchandiseRequest" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_tenantmerchandiserequest"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_tenantmerchandiserequest"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_reservationpackage"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."itemsSnapshot"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "itemsSnapshot" ON public."ReservationPackage" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "itemsSnapshot" ON public."ReservationPackage" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_reservationpackage"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_reservationpackage"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_stockmovement"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."createdById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "createdById" ON public."StockMovement" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "createdById" ON public."StockMovement" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_stockmovement"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_stockmovement"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_dailyclose"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."checks"::text, NEW."closedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "checks", "closedById" ON public."DailyClose" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "checks", "closedById" ON public."DailyClose" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_dailyclose"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_dailyclose"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_reportschedule"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."parameters"::text, NEW."recipients"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "parameters", "recipients" ON public."ReportSchedule" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "parameters", "recipients" ON public."ReportSchedule" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_reportschedule"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_reportschedule"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_savedreport"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."ownerId"::text, NEW."definition"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "ownerId", "definition" ON public."SavedReport" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "ownerId", "definition" ON public."SavedReport" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_savedreport"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_savedreport"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_reporthistoryimport"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."importedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "importedById" ON public."ReportHistoryImport" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "importedById" ON public."ReportHistoryImport" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_reporthistoryimport"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_reporthistoryimport"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_reportrun"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."requestedById"::text, NEW."parameters"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "requestedById", "parameters" ON public."ReportRun" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "requestedById", "parameters" ON public."ReportRun" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_reportrun"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_reportrun"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_communicationtemplate"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."variables"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "variables" ON public."CommunicationTemplate" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "variables" ON public."CommunicationTemplate" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_communicationtemplate"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_communicationtemplate"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_communicationlog"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."metadata"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "metadata" ON public."CommunicationLog" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "metadata" ON public."CommunicationLog" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_communicationlog"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_communicationlog"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_webhookinbox"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."payload"::text, NEW."headers"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "payload", "headers" ON public."WebhookInbox" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "payload", "headers" ON public."WebhookInbox" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_webhookinbox"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_webhookinbox"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_webhookoutbox"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."payload"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "payload" ON public."WebhookOutbox" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "payload" ON public."WebhookOutbox" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_webhookoutbox"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_webhookoutbox"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_auditevent"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."actorId"::text, NEW."before"::text, NEW."after"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "actorId", "before", "after" ON public."AuditEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "actorId", "before", "after" ON public."AuditEvent" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_auditevent"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_auditevent"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_identitydocument"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."reviewedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."IdentityDocument" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "reviewedById" ON public."IdentityDocument" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_identitydocument"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_identitydocument"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_moveintrainingcontrol"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."controllerUserId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "controllerUserId" ON public."MoveInTrainingControl" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "controllerUserId" ON public."MoveInTrainingControl" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_moveintrainingcontrol"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_moveintrainingcontrol"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_moveintrainingrun"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."userId"::text, NEW."state"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "userId", "state" ON public."MoveInTrainingRun" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "userId", "state" ON public."MoveInTrainingRun" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_moveintrainingrun"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_moveintrainingrun"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_facialphotocontrol"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."controllerUserId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "controllerUserId" ON public."FacialPhotoControl" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "controllerUserId" ON public."FacialPhotoControl" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_facialphotocontrol"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_facialphotocontrol"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_marketingactivity"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."createdById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "createdById" ON public."MarketingActivity" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "createdById" ON public."MarketingActivity" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_marketingactivity"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_marketingactivity"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_walkinvisit"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."createdById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "createdById" ON public."WalkInVisit" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "createdById" ON public."WalkInVisit" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_walkinvisit"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_walkinvisit"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_customernote"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."authorId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "authorId" ON public."CustomerNote" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "authorId" ON public."CustomerNote" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_customernote"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_customernote"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_unidentifiedreceiptintake"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."capturedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "capturedById" ON public."UnidentifiedReceiptIntake" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "capturedById" ON public."UnidentifiedReceiptIntake" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_unidentifiedreceiptintake"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_unidentifiedreceiptintake"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_unidentifiedreceiptmatchproposal"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."proposedById"::text, NEW."reviewedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "proposedById", "reviewedById" ON public."UnidentifiedReceiptMatchProposal" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "proposedById", "reviewedById" ON public."UnidentifiedReceiptMatchProposal" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_unidentifiedreceiptmatchproposal"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_unidentifiedreceiptmatchproposal"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_receiptbanksourceprofile"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."requestedById"::text, NEW."reviewedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "requestedById", "reviewedById" ON public."ReceiptBankSourceProfile" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "requestedById", "reviewedById" ON public."ReceiptBankSourceProfile" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_receiptbanksourceprofile"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_receiptbanksourceprofile"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_receiptimportposting"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."snapshot"::text, NEW."postedById"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "snapshot", "postedById" ON public."ReceiptImportPosting" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "snapshot", "postedById" ON public."ReceiptImportPosting" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_receiptimportposting"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_receiptimportposting"() FROM PUBLIC;

CREATE FUNCTION public."stor24_staff_ref_priceapprovalchallenge"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regexp_matches(concat_ws(' ', NEW."requestedById"::text, NEW."approverId"::text), '[a-z0-9]{25,}', 'g') candidate CROSS JOIN LATERAL generate_series(1, length(candidate[1]) - 24) idx JOIN public."DeletedStaffIdentity" deleted ON deleted."id" = substring(candidate[1] FROM idx FOR 25)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted staff identity cannot be added to business records.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_ref_fence" BEFORE INSERT OR UPDATE OF "requestedById", "approverId" ON public."PriceApprovalChallenge" FOR EACH STATEMENT EXECUTE FUNCTION public.stor24_staff_reference_statement();
CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF "requestedById", "approverId" ON public."PriceApprovalChallenge" FOR EACH ROW EXECUTE FUNCTION public."stor24_staff_ref_priceapprovalchallenge"();
REVOKE ALL ON FUNCTION public."stor24_staff_ref_priceapprovalchallenge"() FROM PUBLIC;

COMMIT;
