CREATE TABLE "InsurancePlan" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "providerName" TEXT,
  "coverageAmount" DECIMAL(14,2) NOT NULL,
  "monthlyPremium" DECIMAL(14,2) NOT NULL,
  "excessAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "policyVersion" TEXT,
  "termsUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InsurancePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InsuranceEnrollment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "tenancyId" TEXT NOT NULL,
  "planId" TEXT,
  "status" TEXT NOT NULL,
  "providerName" TEXT,
  "policyVersion" TEXT,
  "coverageAmount" DECIMAL(14,2),
  "monthlyPremium" DECIMAL(14,2),
  "excessAmount" DECIMAL(14,2),
  "effectiveFrom" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3) NOT NULL,
  "waiverReason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InsuranceEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InsurancePlan_organisationId_facilityId_code_key" ON "InsurancePlan"("organisationId", "facilityId", "code");
CREATE UNIQUE INDEX "InsurancePlan_organisation_code_global_key" ON "InsurancePlan"("organisationId", "code") WHERE "facilityId" IS NULL;
CREATE INDEX "InsurancePlan_organisationId_active_idx" ON "InsurancePlan"("organisationId", "active");
CREATE INDEX "InsurancePlan_facilityId_active_idx" ON "InsurancePlan"("facilityId", "active");
CREATE UNIQUE INDEX "InsuranceEnrollment_tenancyId_key" ON "InsuranceEnrollment"("tenancyId");
CREATE INDEX "InsuranceEnrollment_organisationId_status_idx" ON "InsuranceEnrollment"("organisationId", "status");
CREATE INDEX "InsuranceEnrollment_facilityId_status_idx" ON "InsuranceEnrollment"("facilityId", "status");

ALTER TABLE "InsurancePlan" ADD CONSTRAINT "InsurancePlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsurancePlan" ADD CONSTRAINT "InsurancePlan_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsuranceEnrollment" ADD CONSTRAINT "InsuranceEnrollment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsuranceEnrollment" ADD CONSTRAINT "InsuranceEnrollment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsuranceEnrollment" ADD CONSTRAINT "InsuranceEnrollment_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsuranceEnrollment" ADD CONSTRAINT "InsuranceEnrollment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InsurancePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
