-- Existing copies keep their acknowledged fixed expiry. Never extend them implicitly.
ALTER TABLE "IdentityDocument" ADD COLUMN "retentionMode" TEXT NOT NULL DEFAULT 'FIXED_PERIOD';
ALTER TABLE "IdentityDocument" ALTER COLUMN "expiresAt" DROP NOT NULL;
ALTER TABLE "IdentityDocument" ADD CONSTRAINT "IdentityDocument_retention_valid"
  CHECK (("retentionMode" = 'FIXED_PERIOD' AND "expiresAt" IS NOT NULL)
      OR ("retentionMode" = 'TENANCY' AND "expiresAt" IS NULL));
