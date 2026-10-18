# Debit failure evidence required for the seven-day arrears clock

Status on 18 October 2026: the authoritative final-failure-to-original-debt ingestion is **not implemented**. Debit cases remain held. Upload acceptance, a submission exception, a pending result and `Payment.FAILED` do not start the clock. No collection-date fallback is allowed.

## Verified source and current limitation

Netcash's [statement specification](https://api.netcash.co.za/standard-integration/netcash-statement/) describes the authenticated daily statement request/retrieve process, a transaction date and unique transaction ID, and upload-defined extra reference fields. It identifies DRU as an unpaid debit transaction and separately identifies tracking and disputed transaction types. [Netcash's report guide](https://help.netcash.co.za/docs/account-profile/debit-orders/reports/) explains matching returned items to their original batch. These are evidence sources to integrate, not a licence to treat any negative balance or intake rejection as a confirmed failure.

Current STOR24 compact uploads contain customer mandate reference and amount, while the local instruction retains original run, account, period, invoice and mandate identity. The upload report establishes intake acceptance only. Existing statement return handling protects prior posted receipts; it does not supply an authoritative first unpaid outcome bound to an original unpaid charge. Public documentation alone does not establish this merchant's complete returned reference mapping, enabled product or exact final outcome semantics.

## Required acceptance contract

1. Use the authenticated provider result/statement for the correct merchant, connection, organisation and store. Retain source identity, retrieval time, immutable raw evidence hash and unique provider event identity.
2. Bind the actual returned batch/instruction/reference, original action date and exact amount to one local instruction, invoice and original charge. A customer reference alone is insufficient where batches/retries can share it. Ambiguous or conflicting mappings stay held.
3. Distinguish final unpaid from upload rejection, technical failure, tracking, pending, dispute and later reversal/correction. Preserve the provider reason and confirmed failure date/time precision; do not invent a timestamp from receipt time or due date.
4. One original debt has one first confirmed-failure clock. A retry does not restart it. Duplicate/out-of-order events cannot create a second clock or silently overwrite a correction. Contradictory or reversed evidence forces review.
5. Evaluate seven calendar days in South African time, then recheck outstanding original debt, reconciled receipts, pending evidence, disputes and arrangements. The result prepares an internal review only. Legal notice, access approval/execution/restoration and every fee/financial entry remain separate.

Provider fixture qualification must include redacted real-format first-unpaid and retry results, duplicates, tracking-to-final transition, mismatched merchant/batch/amount, ambiguous references, later correction and settlement. Synthetic fixtures alone do not prove actual merchant delivery or original-charge binding. No financial posting or bank/provider activation is authorised by this document.
