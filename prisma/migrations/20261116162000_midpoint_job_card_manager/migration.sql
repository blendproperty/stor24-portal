INSERT INTO "Role" ("id", "organisationId", "name", "permissions", "updatedAt")
SELECT 'midpoint-job-card-manager-' || md5("organisationId"), "organisationId", 'Midpoint job card manager',
  ARRAY['maintenance.job_cards.manage']::text[], CURRENT_TIMESTAMP
FROM "Facility"
WHERE "name" = 'Store 1 - Midpoint' AND "active"
GROUP BY "organisationId"
ON CONFLICT ("organisationId", "name") DO NOTHING;
