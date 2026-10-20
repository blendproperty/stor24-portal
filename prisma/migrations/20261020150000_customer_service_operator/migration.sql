-- Add an unassigned role only; no existing staff permissions or store scope change.
INSERT INTO "Role" ("id", "organisationId", "name", "permissions", "updatedAt")
SELECT 'cso-' || md5("id"), "id", 'Customer service operator', ARRAY['leads.*','reservations.*','move_in.create','operations.view','operations.manage','facility_map.view','phone.view','communications.view','customer_history.export','reservation_prices.view','reservation_prices.propose']::text[], CURRENT_TIMESTAMP
FROM "Organisation"
ON CONFLICT ("organisationId", "name") DO NOTHING;
