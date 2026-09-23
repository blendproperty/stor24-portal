ALTER TABLE "FacialPhotoSubmission" ALTER COLUMN "expiresAt" DROP NOT NULL;
CREATE TABLE "FacialPhotoControl" (
 "organisationId" TEXT NOT NULL PRIMARY KEY,
 "controllerUserId" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "version" INTEGER NOT NULL DEFAULT 1,
 "policyVersion" TEXT NOT NULL DEFAULT 'interim-20260923-v1',
 "updatedAt" TIMESTAMP(3) NOT NULL
);
