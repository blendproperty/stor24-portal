BEGIN;
ALTER TABLE "DeletedStaffIdentity" ADD COLUMN "organisationId" TEXT, ADD COLUMN "originalEmail" TEXT;
ALTER TABLE "DeletedStaffIdentity" ADD CONSTRAINT "retained_identity_has_alias" CHECK (NOT "retained" OR ("organisationId" IS NOT NULL AND "originalEmail" IS NOT NULL));
CREATE INDEX "DeletedStaffIdentity_organisationId_originalEmail_idx" ON "DeletedStaffIdentity"("organisationId", "originalEmail");
COMMIT;
