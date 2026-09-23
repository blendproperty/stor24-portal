CREATE TABLE "MoveInTrainingControl" (
 "organisationId" TEXT NOT NULL PRIMARY KEY, "controllerUserId" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 1,
 "generation" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "MoveInTrainingRun" (
 "id" TEXT NOT NULL PRIMARY KEY, "organisationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "facilityId" TEXT NOT NULL, "generation" INTEGER NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "state" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "MoveInTrainingRun_organisationId_userId_facilityId_key" ON "MoveInTrainingRun"("organisationId", "userId", "facilityId");
