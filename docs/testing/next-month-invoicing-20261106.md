# Next-month scheduled invoicing candidate

The candidate is default-off. The independent cron endpoint requires a separately configured SHA-256 key and `NEXT_MONTH_INVOICING_ENABLED=true`; it accepts no period or date from the caller. It targets the following calendar month on the 17th in South Africa by default; a store manager can set a different date for the current month. No cron, key, switch, provider or production data has been configured.

Only active, handed-over, reconciled accounts with approved billing plans are candidates. Notice, active discounts, incomplete evidence and multiple active accounts for the same customer and store are held as explicit exceptions. Multiple accounts must be resolved using the combined invoice workflow, not separately invoiced by this runner. The process saves invoices and posts account charges; it does not email invoices. Repeated calls are protected by existing billing and invoice uniqueness controls.

## Mandatory review before activation

- Finance must determine whether invoices generated before the next month should update each customer balance immediately. This candidate posts a future-effective ledger entry and immediately increments the stored balance, matching the existing posting service. Other existing workflows can hold accounts with future-dated entries until the effective date. Do not enable this candidate until finance approves the accounting and downstream behavior or the implementation is corrected.
- Faeez confirmed manager review and sending, no move-out proration, and manager discretion when a customer on notice stays longer. This candidate holds all notice and active-discount cases and sends no email. It does not yet implement manager review/send, safe resend, multi-month invoicing or the first-month offers.
- Complete combined-invoice integration, exceptional account reconciliation, migration and financial review, authenticated staff/finance UAT and production release approval. No isolated test establishes live customer correctness or delivery.
- Choose and document the scheduler, exact SAST time, key custody, monitoring, exception ownership and recovery. Do not install or activate a scheduler before approval.

Synthetic tests exercise date and scope guards, missing handover, notice and multi-account holds, disabled mode, separate authentication, retry/concurrency and absence of outbound communications. They do not prove live data, provider behavior or finance acceptance.

The candidate currently creates an invoice and ledger charge before manager review. Faeez wants managers to exclude notice cases without accounting needing a credit note; review the treatment of a notice given after generation before enabling.
