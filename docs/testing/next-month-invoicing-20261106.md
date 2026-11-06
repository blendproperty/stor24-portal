# Next-month scheduled invoicing candidate

The candidate is default-off. The independent cron endpoint requires a separately configured SHA-256 key and `NEXT_MONTH_INVOICING_ENABLED=true`; it accepts no period or date from the caller. It targets the following calendar month on the 17th in South Africa by default; a store manager can set a different date for the current month. No cron, key, switch, provider or production data has been configured.

Only active, handed-over, reconciled accounts with approved billing plans are candidates. Notice, active discounts, incomplete evidence and multiple active accounts for the same customer and store are held as explicit exceptions. Multiple accounts must be resolved using the combined invoice workflow, not separately invoiced by this runner. The scheduled process prepares a review draft without posting an account charge. A manager must review and approve before an invoice and charge are posted. It does not automatically email invoices. A manager may explicitly send or resend a saved monthly or multi-month invoice to the current customer email. Unconfirmed delivery is held for review; provider acceptance is not inbox delivery. Repeated posting is protected by billing and invoice uniqueness controls.

## Mandatory review before activation

- Finance must determine whether invoices generated before the next month should update each customer balance immediately. On manager approval the candidate posts a future-effective ledger entry and immediately increments the stored balance, matching the existing posting service. Other existing workflows can hold accounts with future-dated entries until the effective date. Do not enable this candidate until finance approves the accounting and downstream behavior or the implementation is corrected.
- Faeez confirmed manager review and sending, no move-out proration, and manager discretion when a customer on notice stays longer. This candidate holds all notice and active-discount cases and sends no email. The current candidate adds manager review, explicit send/resend and single-account multi-month invoices; the first-month offers and combined-account delivery remain open.
- Complete combined-invoice integration, treatment and recovery of uncertain delivery, exceptional account reconciliation, migration and financial review, authenticated staff/finance UAT and production release approval. No isolated test establishes live customer correctness or delivery.
- Choose and document the scheduler, exact SAST time, key custody, monitoring, exception ownership and recovery. Do not install or activate a scheduler before approval.

Synthetic tests exercise date and scope guards, missing handover, notice and multi-account holds, disabled mode, separate authentication, retry/concurrency and absence of outbound communications. They do not prove live data, provider behavior or finance acceptance.

The scheduler creates a review draft without an invoice or charge. Approval rechecks notice and financial evidence; a changed account invalidates the draft. A notice after approval still needs a separately reviewed accounting process.

Single-account multi-month billing currently supports 2–12 months beginning in the current or next month. It holds active discounts, notice and multiple accounts for review, and posts all selected charges atomically only after staff confirmation. It immediately affects the balance, including future-effective charges; finance acceptance is required.

Managers may select up to 50 customer accounts and review their prepared drafts together. Approval processes each eligible account separately and displays a result for each; an interrupted request requires checking every account before retrying. No customer emails are sent as part of the batch. Multiple accounts belonging to the same customer and store remain held for the combined-invoice workflow until integration is complete.
