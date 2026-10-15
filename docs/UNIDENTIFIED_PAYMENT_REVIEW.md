# Unidentified payment investigation

This workspace retains evidence and matching suggestions. It does not create a Payment, ledger receipt, allocation, refund, provider request or verified collection. A reviewed suggestion is not payment confirmation or authority to post money.

## Staff process

1. Open Billing > Unidentified payment review. Choose the review store and retain the original reference, date, amount and investigation note. Do not enter bank account/card numbers. Manually reported evidence remains unverified.
2. Organisation-wide authorised finance users may select an existing unresolved supported credit from the original bank or Netcash imports. Selection is fingerprint-bound and rechecked; original imports are not changed. Authorisations, zero/non-cent/negative amounts, already resolved movements and unsupported sources are excluded. Imported bank records have no retained currency field: the interface explicitly requires original currency review and does not label their amounts as verified ZAR. Target-account review is currently ZAR only. Test sources are retained separately and cannot be matched here.
3. Search the exact account in the same store. Check the original evidence, record the matching reason and explicitly confirm a suggestion. The account must have a consistent same-organisation/store tenancy. No account or payment is created automatically. Replacements preserve earlier suggestions.
4. A different authorised colleague from both capturer and proposer checks the original source and target, records a reference and reviews or rejects the suggestion. Source/account changes hold review. Withdrawal preserves the original and proposal history. The separate finance process must still verify receipt, currency, allocation and any posting approval; this workspace has no posting endpoint.

## Access and source controls

Separate receipt_review.view/capture/propose/approve grants are registered; no existing employee grant is changed. All actions intersect the selected-store view grant. Account reads/proposals/review also require ledger.view in that same store. Whole imported sources additionally require organisation-wide capture and settlements.view. Native guides have matching access policy. Sensitive original references/notes and proposal details use the existing encrypted vault. API responses omit ciphertext, raw files, credentials and unnecessary account contact data. No CSV export bypass is introduced.

Source identity is unique within the organisation and environment; capture retries use a request key and original input hash. Immutable amount/date/source fingerprints, account snapshots, revision checks, retained proposal history and transactional audit bind every change. Org-scoped mutation locking and account locks guard concurrent matching. All source formats remain bounded. The list uses50-record cursor pages; source candidates and proposal history explicitly disclose their bounds.

## Verification and remaining gates

Local policy/guide tests and API admission tests pass, and synthetic actual browser fixtures cover1440/768/390/320, exact suggestion, second-person review, uncertain/read-refresh recovery, access changes, test/currency holds and pagination. Initial accessibility label and effect lifecycle lint issues were corrected. Final typecheck, changed-source lint, schema validation and production build pass. The bounded unit suite returned821 results/820 pass/one existing skip. New unconditional PostgreSQL execution remains required at this checkpoint. Database scenarios cover immutable financial baselines, source/organisation/store binding, idempotency/concurrency, account/source changes, authorisation/test exclusion, encrypted evidence and audit rollback. These are isolated tests, not production reconciliation.

Finance source quality, original bank currency proof, historical completeness, actual receipt/settlement/ledger allocation, provider credentials/contracts, staff training and real staff/finance UAT remain gates. No live unidentified payment has been captured, reviewed or posted by this rollout. Original Faeez item2 remains an operational acceptance item until the deployed review workflow is accepted; actual financial execution stays separate.
