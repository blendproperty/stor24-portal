# Debit failure evidence required for the seven-day arrears clock

Status on 19 October 2026: the authoritative final-failure-to-original-debt ingestion is **not implemented**. The provider-independent reconciliation core is now implemented separately in `src/lib/arrears-debit-evidence.ts`, but is not connected to live eligibility. Debit cases remain held. Upload acceptance, a submission exception, a pending result and `Payment.FAILED` do not start the clock. No collection-date fallback is allowed.

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

## Implemented reconciliation core (19 October)

The strict normalized instruction/result schemas and deterministic reducer bind organisation, store, merchant, connection, account, original charge, invoice, mandate, batch, instruction, customer reference, original action date, exact amount and rand currency. Partial/ambiguous mappings stay held. Date-only failure evidence retains its precision; timestamp evidence uses its South African calendar day, with seven calendar days including weekends. Retrieval time never becomes failure time.

The complete retained result set preserves the earliest confirmed failure across retries. Exact duplicate deliveries do not restart the clock. Reused event identities with conflicting evidence, changing instruction/failure dates, unmatched records, missing retry outcomes, pending/tracking/technical results and correction/dispute/settlement evidence remain held as appropriate. Out-of-order tracking-to-final transitions are deterministic. A later unpaid result cannot silently clear a correction or settlement hold. This conservative version requires separate reconciliation for such cases.

This is an internal adapter contract, **not a public import endpoint**. Schema validation is not provider authentication. No consumer, durable importer, merchant-specific parser, reconciliation-clearance command or route is added. The future adapter must authenticate the real source, retain raw evidence and complete history, uniquely map real local instructions to original charges, establish retrieval completeness and recheck current ledger/payment/dispute/arrangement holds before using any reconciled clock. `reviewDateReached` is not eligibility or approval for access or fees. Existing debit-order preparation remains held even if this standalone reducer qualifies synthetic evidence.

Remaining integration requires Netcash's merchant-specific results/mapping contract and real-format fixtures. The approved information request was sent on19October and independently verified in Sent Items, together with the legal wording and installed access-system contract requests. Copies of the original reviewed drafts remain unsent; do not send them again.
