-- Capture the provider environment at checkout, never infer it from a later configuration change.
ALTER TABLE "Payment" ADD COLUMN "environment" TEXT;
-- Do not rewrite historical payments, balances or ledger entries. Explicit legacy test keys
-- are recognised at read/settlement time; ambiguous historical records require reconciliation.
