# Controlled adjustments and externally completed refunds

21 September 2026. Billing → Refund approvals / Adjustments provides scoped requests, independent approval, atomic ledger posting, immutable adjustment records and an audit history. Financial acceptance remains separate from implementation/testing.

## Supported workflow

1. Select an account in a permitted store, correction type, original charge/receipt, amount, reason and supporting evidence reference. Preview shows source, included tax and balance before/after.
2. Save a request with the reviewed fingerprint. Only one pending/approved request per account is allowed. Creation does not alter the balance.
3. A different authorised person approves or rejects. Additional charges, source-linked credits, unpaid-debt write-offs and full receipt reversals post exactly once at approval. Both users require their own facility-scoped permissions. Owner status does not bypass the different-user rule.
4. Refund approval does not post a ledger entry or send money. Arrange a separately authorised payout outside this application. Record it only after verifying actual completion, using a unique payout reference and date between approval and today. This increases the account balance and updates the original payment's refund status. It never calls Netcash or a bank.
5. Inspect the original ledger history, the saved adjustment record and the corrected account statement. Records post on the current date; external payout date is retained separately. No historical entry or original invoice is rewritten or deleted.

## Financial controls

- Credits are limited to the unadjusted source charge, including earlier credits/write-offs. Tax is proportional to the original charge, capped at its remaining tax. Charges require an explicitly entered included-tax amount. Write-offs do not claim tax relief and cannot exceed positive outstanding debt.
- Refunds require both a negative reconciled balance and an eligible original receipt; they cannot exceed either. Only real, audited manual receipts or independently verified live Netcash receipts qualify. Merchandise receipts and test/unknown provider evidence are excluded.
- Full receipt reversals cannot follow partial refunds or other adjustments to that receipt. Reversed/refunded/partially refunded payment states cannot be reset by repeat success callbacks or reused checkout requests.
- Dashboard and billing collection totals preserve the original receipt in its original period and deduct posted refunds/reversals in the correction period. A partial refund does not remove the entire original receipt. Email statement arithmetic resolves reversal direction from the original entry and treats refunds as debits, consistent with the existing downloadable account statement.
- Saved store Program defaults → Refunds minimum/maximum values are enforced. Zero means that limit is disabled. A maximum is a hard ceiling: the old named security-level override is not interpreted as financial authority. Merchandise return-age settings do not apply to tenant overpayments.
- Each mutation locks the account in a serializable transaction. Unique request keys, ledger references and payout references prevent duplicate recording. Changed balances/source evidence/policies invalidate approval; a failed posting rolls back the approval, ledger, balance, payment state, document and audit together.
- Historical test ledger contamination, account/ledger disagreement, future ledger entries, unallocated historical correction entries and reserved collection runs require finance review. An open adjustment also excludes the account from debit-order preparation/submission.
- Unposted requests can be cancelled by their requester or reviewer with an explanation. Never cancel a refund already paid. If the account changed after approval and before payout recording, finance must reconcile the external payout before any further action.

## Scope and open gates

This release does not send bank/provider refunds, issue customer messages, export MRI journals, perform stock returns, reconcile off-ledger deposit liabilities, fix historical test balances, or override collection/period-close policy. It displays at most 500 accounts and the latest 100 requests. No financial records are created by merely opening the page.

The generated record is an account adjustment record, not a claim of approved statutory tax-credit-note wording. Finance must approve tax treatment and document requirements, source/opening-balance reconciliation, real correction/refund UAT, authorised staff roles, the external payout process and training before operational sign-off. All prior legal/provider/settlement/physical-access gates remain open.
