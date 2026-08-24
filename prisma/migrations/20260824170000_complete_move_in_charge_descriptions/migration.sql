-- Backfill completed tenancies created before the activation-path fix.
UPDATE "LedgerEntry" AS ledger
SET "description" = 'Move-in charge'
FROM "Tenancy" AS tenancy
WHERE tenancy."accountId" = ledger."accountId"
  AND tenancy."status" IN ('ACTIVE', 'NOTICE_GIVEN', 'CLOSED')
  AND ledger."type" = 'CHARGE'
  AND ledger."description" = 'Move-in charge (pending lease signature)';
