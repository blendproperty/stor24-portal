CREATE TABLE "TenantPortalChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organisationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "customerIds" TEXT[] NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TenantPortalChallenge_expiresAt_idx" ON "TenantPortalChallenge"("expiresAt");
CREATE TABLE "TenantPortalSession" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "organisationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "customerIds" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TenantPortalSession_expiresAt_idx" ON "TenantPortalSession"("expiresAt");
