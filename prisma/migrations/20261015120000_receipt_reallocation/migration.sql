CREATE TABLE "ReceiptReallocation" (
 "id" TEXT NOT NULL PRIMARY KEY, "organisationId" TEXT NOT NULL, "facilityId" TEXT NOT NULL,
 "sourceAccountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "targetAccountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sourceEntryId" TEXT NOT NULL REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "paymentId" TEXT NOT NULL REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sourceLedgerEntryId" TEXT UNIQUE REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "targetLedgerEntryId" TEXT UNIQUE REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sourceDocumentId" TEXT UNIQUE REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "targetDocumentId" TEXT UNIQUE REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK ("status" IN ('PENDING_APPROVAL','POSTED','REJECTED','CANCELLED')),
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0), "amount" DECIMAL(14,2) NOT NULL CHECK ("amount">0),
 "reason" TEXT NOT NULL, "evidenceReference" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "fingerprint" TEXT NOT NULL,
 "requestedById" TEXT NOT NULL, "reviewedById" TEXT, "reviewReference" TEXT, "reviewedAt" TIMESTAMP(3),
 "postedById" TEXT, "postedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("sourceAccountId"<>"targetAccountId"),
 CHECK ("sourceLedgerEntryId" IS NULL OR "targetLedgerEntryId" IS NULL OR "sourceLedgerEntryId"<>"targetLedgerEntryId"),
 CHECK ("status" NOT IN ('POSTED','REJECTED') OR ("reviewedById" IS NOT NULL AND "reviewedById"<>"requestedById" AND "reviewReference" IS NOT NULL AND "reviewedAt" IS NOT NULL)),
 CHECK ("status"<>'POSTED' OR ("sourceLedgerEntryId" IS NOT NULL AND "targetLedgerEntryId" IS NOT NULL AND "sourceDocumentId" IS NOT NULL AND "targetDocumentId" IS NOT NULL AND "postedById" IS NOT NULL AND "postedById"="reviewedById" AND "postedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ReceiptReallocation_organisationId_requestKey_key" ON "ReceiptReallocation"("organisationId","requestKey");
CREATE UNIQUE INDEX "ReceiptReallocation_one_pending_source" ON "ReceiptReallocation"("organisationId","sourceEntryId") WHERE "status"='PENDING_APPROVAL';
CREATE INDEX "ReceiptReallocation_org_store_created_idx" ON "ReceiptReallocation"("organisationId","facilityId","createdAt","id");
CREATE INDEX "ReceiptReallocation_sourceAccountId_status_idx" ON "ReceiptReallocation"("sourceAccountId","status");
CREATE INDEX "ReceiptReallocation_targetAccountId_status_idx" ON "ReceiptReallocation"("targetAccountId","status");
CREATE INDEX "ReceiptReallocation_sourceEntryId_status_idx" ON "ReceiptReallocation"("sourceEntryId","status");
CREATE INDEX "ReceiptReallocation_paymentId_status_idx" ON "ReceiptReallocation"("paymentId","status");
CREATE FUNCTION receipt_reallocation_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."id",NEW."organisationId",NEW."facilityId",NEW."sourceAccountId",NEW."targetAccountId",NEW."sourceEntryId",NEW."paymentId",NEW."requestKey",NEW."requestHash",NEW."amount",NEW."reason",NEW."evidenceReference",NEW."snapshot",NEW."fingerprint",NEW."requestedById",NEW."createdAt")
 IS DISTINCT FROM ROW(OLD."id",OLD."organisationId",OLD."facilityId",OLD."sourceAccountId",OLD."targetAccountId",OLD."sourceEntryId",OLD."paymentId",OLD."requestKey",OLD."requestHash",OLD."amount",OLD."reason",OLD."evidenceReference",OLD."snapshot",OLD."fingerprint",OLD."requestedById",OLD."createdAt") THEN
  RAISE EXCEPTION 'Receipt allocation request and original evidence are immutable';
 END IF;
 IF OLD."status"<>'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Terminal receipt allocation evidence is immutable'; END IF;
 IF NEW."revision"<>OLD."revision"+1 OR NEW."status"='PENDING_APPROVAL' THEN RAISE EXCEPTION 'Receipt allocation transition requires a fresh terminal decision'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER receipt_reallocation_request_immutable BEFORE UPDATE ON "ReceiptReallocation" FOR EACH ROW EXECUTE FUNCTION receipt_reallocation_request_immutable();
