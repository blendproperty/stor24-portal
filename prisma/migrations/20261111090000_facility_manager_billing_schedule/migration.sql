DO $$
DECLARE current_permissions text[]; role_id text;
DECLARE expected text[] := ARRAY['facility.*','reports.view','leads.*','reservations.*','move_in.create','operations.view','operations.manage','inventory.view','inventory.*','facility_map.view','reservation_prices.view','reservation_prices.propose','billing.view','billing.documents.send','ledger.view','reports.financial','reports.sales','reports.collections','reports.export','communications.view','payments.view','payments.manage','collections.*','collections.view','collections.manage','collections.policy','collections.export']::text[];
BEGIN
  SELECT r."id", r."permissions" INTO role_id, current_permissions FROM "Role" r JOIN "Organisation" o ON o."id" = r."organisationId" WHERE o."slug" = 'stor24' AND r."name" = 'Facility manager' FOR UPDATE OF r;
  IF FOUND THEN
    IF NOT (current_permissions @> expected AND current_permissions <@ expected) THEN RAISE EXCEPTION 'Facility manager permissions differ from reviewed baseline'; END IF;
    IF EXISTS (SELECT 1 FROM "RoleAssignment" WHERE "roleId" = role_id AND "facilityId" IS NULL) THEN RAISE EXCEPTION 'Facility manager has unscoped assignments; resolve before granting'; END IF;
    UPDATE "Role" SET "permissions" = ARRAY['facility.*','reports.view','leads.*','reservations.*','move_in.create','operations.view','operations.manage','inventory.view','inventory.*','facility_map.view','reservation_prices.view','reservation_prices.propose','billing.view','billing.schedule.manage','billing.documents.send','ledger.view','reports.financial','reports.sales','reports.collections','reports.export','communications.view','payments.view','payments.manage','collections.*','collections.view','collections.manage','collections.policy','collections.export']::text[], "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = role_id;
  END IF;
END $$;
