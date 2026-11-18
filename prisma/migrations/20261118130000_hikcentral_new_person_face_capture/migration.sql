ALTER TABLE "HikCentralFaceCapture" ALTER COLUMN "personId" DROP NOT NULL;
ALTER TABLE "HikCentralFaceHandoff" ALTER COLUMN "personId" DROP NOT NULL;
ALTER TABLE "HikCentralFaceCapture" ADD COLUMN "firstNameSnapshot" TEXT, ADD COLUMN "lastNameSnapshot" TEXT;
ALTER TABLE "HikCentralFaceHandoff" ADD COLUMN "firstNameSnapshot" TEXT, ADD COLUMN "lastNameSnapshot" TEXT;
