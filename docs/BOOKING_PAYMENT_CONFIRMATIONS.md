# Booking payment confirmations

Implemented29September2026, PR354. Applies to newly settled Netcash booking payments, not historical payment backfill or the separate audit-only training payment panel.

- Only independently verified matching provider evidence can settle a payment. A matching signed reservation, organisation and verified customer email are required for a confirmation.
- The settlement transaction creates one outbox entry keyed by payment ID. Sandbox results do not post financial entries or authorise keys/access. Confirmation contains booking reference, unit, amount and My STOR24 next steps.
- The webhook claims PENDING to PROCESSING before calling the configured email provider. Duplicate callbacks can pick up a still-PENDING entry, but cannot re-send PROCESSING/SUCCEEDED/FAILED entries.
- SUCCEEDED records provider acceptance, not independently verified recipient inbox delivery. FAILED records EMAIL_DELIVERY_REVIEW; an interruption may leave PROCESSING. Check provider delivery evidence before any separately authorised resend. No automatic resend of ambiguous outcomes or general outbox worker is introduced.
- The current Unit107 historical test is not retroactively emailed. Do not repeat a financial transaction just to obtain an email.

Validation: template escaping/test-vs-live unit test; synthetic600/390/320px HTML render; isolated PostgreSQL concurrent settlement/delivery, failure/no duplicate, test-finance invariance and verified live settlement tests. Provider inbox acceptance remains attended UAT. No customer email was sent during development.
