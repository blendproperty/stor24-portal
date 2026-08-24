CREATE UNIQUE INDEX "IntegrationConnection_hikcentral_company_unique"
ON "IntegrationConnection" ("organisationId", "category", "provider")
WHERE "facilityId" IS NULL
  AND "category" = 'ACCESS_CONTROL'
  AND "provider" = 'HIKCENTRAL';
