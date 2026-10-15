ALTER TABLE "ReceiptReallocation" ADD COLUMN "operation" TEXT NOT NULL DEFAULT 'MOVE', ADD COLUMN "reversesId" TEXT REFERENCES "ReceiptReallocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceiptReallocation" ADD CONSTRAINT "ReceiptReallocation_operation_check" CHECK ("operation" IN ('MOVE','UNDO')),
 ADD CONSTRAINT "ReceiptReallocation_undo_parent_check" CHECK (("operation"='MOVE' AND "reversesId" IS NULL) OR ("operation"='UNDO' AND "reversesId" IS NOT NULL AND "reversesId"<>"id"));
CREATE INDEX "ReceiptReallocation_reversesId_status_idx" ON "ReceiptReallocation"("reversesId","status");
CREATE OR REPLACE FUNCTION receipt_reallocation_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."operation",NEW."reversesId",NEW."id",NEW."organisationId",NEW."facilityId",NEW."sourceAccountId",NEW."targetAccountId",NEW."sourceEntryId",NEW."paymentId",NEW."requestKey",NEW."requestHash",NEW."amount",NEW."reason",NEW."evidenceReference",NEW."snapshot",NEW."fingerprint",NEW."requestedById",NEW."createdAt")
 IS DISTINCT FROM ROW(OLD."operation",OLD."reversesId",OLD."id",OLD."organisationId",OLD."facilityId",OLD."sourceAccountId",OLD."targetAccountId",OLD."sourceEntryId",OLD."paymentId",OLD."requestKey",OLD."requestHash",OLD."amount",OLD."reason",OLD."evidenceReference",OLD."snapshot",OLD."fingerprint",OLD."requestedById",OLD."createdAt") THEN
  RAISE EXCEPTION 'Receipt allocation request and original evidence are immutable';
 END IF;
 IF OLD."status"<>'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Terminal receipt allocation evidence is immutable'; END IF;
 IF NEW."revision"<>OLD."revision"+1 OR NEW."status"='PENDING_APPROVAL' THEN RAISE EXCEPTION 'Receipt allocation transition requires a fresh terminal decision'; END IF;
 RETURN NEW;
END;
$$;
