-- Requested by Brett: Midpoint's upper floors are still under construction.
-- Exact public store identity verified read-only before preparing this migration.
-- Preserve all unit, reservation, occupancy, maintenance and accounting records.
WITH changed AS (
  UPDATE "Facility"
  SET "closedFloors" = ARRAY['first floor', 'second floor']::TEXT[], "updatedAt" = CURRENT_TIMESTAMP
  WHERE "publicSlug" = 'midpoint' AND cardinality("closedFloors") = 0
  RETURNING id, "organisationId"
)
INSERT INTO "AuditEvent" (id, "organisationId", "facilityId", action, "entityType", "entityId", before, after, "occurredAt")
SELECT 'midpoint-floor-closure-' || md5(id), "organisationId", id,
  'facility.floor_availability_initialised', 'Facility', id,
  '{"closedFloors":[]}'::jsonb,
  '{"closedFloors":["first floor","second floor"],"reason":"Upper floors under construction; requested by Brett"}'::jsonb,
  CURRENT_TIMESTAMP
FROM changed;
