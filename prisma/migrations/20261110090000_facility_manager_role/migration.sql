-- Preserve an unexpected customised role rather than replacing it silently.
DO $$
DECLARE current_permissions text[];
BEGIN
  SELECT r."permissions" INTO current_permissions FROM "Role" r JOIN "Organisation" o ON o."id" = r."organisationId" WHERE o."slug" = 'stor24' AND r."name" = 'Facility manager' FOR UPDATE OF r;
  IF FOUND THEN
    IF NOT (current_permissions @> ARRAY['facility.*','reports.view']::text[] AND current_permissions <@ ARRAY['facility.*','reports.view']::text[]) THEN
      RAISE EXCEPTION 'Facility manager role differs from reviewed baseline; reconcile before migration';
    END IF;
    UPDATE "Role" r SET "permissions" = ARRAY['facility.*','reports.view','leads.*','reservations.*','move_in.create','operations.view','operations.manage','inventory.view','inventory.*','facility_map.view','reservation_prices.view','reservation_prices.propose','billing.view','billing.documents.send','ledger.view','reports.financial','reports.sales','reports.collections','reports.export','communications.view']::text[], "updatedAt" = CURRENT_TIMESTAMP FROM "Organisation" o WHERE r."organisationId" = o."id" AND o."slug" = 'stor24' AND r."name" = 'Facility manager';
  END IF;
END $$;
