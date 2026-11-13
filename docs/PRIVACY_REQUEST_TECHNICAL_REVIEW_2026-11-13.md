# Privacy-request technical review — 13 November 2026

This is partial technical evidence for PRIV-06, not a completed staff rehearsal, legal approval or a complete data-subject request process. CRM source baseline: `ba9f3217b41235a9eb56494104ac792583543544`. No production customer, document, payment, provider or configuration was changed.

## Tested technical paths

A disposable local PostgreSQL database with synthetic fixtures ran the current integration suites for booking contact correction, identity documents and facial photos. All 29 reported tests passed. These tests use synthetic identities and policies, not real approvals or provider accounts.

- Booking contact correction exercises a booking-scoped correction, verification-code invalidation, preservation of the hold, invalid or shared-customer rejection and audit records without plain contact values. This is a booking correction path, not evidence that every customer record and provider copy can be corrected.
- Identity tests cover scope denial, withdrawal and erasure of the stored identity image, signing gates, expiry and legal-hold behaviour. Review and audit metadata can remain; image deletion is not deletion of every customer record or backup.
- Photo tests cover scoped access, withdrawal and clearing the portal image, expiry, and audit/review paths. The separate provider/device biometric record is not deleted by the portal photo withdrawal. See [MEL ownership matrix](MEL_INTEGRATION_OWNERSHIP_MATRIX.md).

The empty-database bootstrap used the repository's documented migration recovery for its known historical ordering issue, and finished applying all 95 migrations to the disposable database. This is not production migration or restore evidence. The container was stopped after testing.

## Staff rehearsal to complete

Use the [operating pack](PRIORITY_2_OPERATING_PACK.md) with a clearly labelled synthetic case and a restricted case record. The exercise should demonstrate, with named participants and dated evidence:

1. Intake and acknowledgement at the published privacy address; do not send a real external message or solicit identity copies for the simulation.
2. Proportionate verification and a correction request, including an unauthorised request that must not disclose or change records. Record which system and provider copies require follow-up.
3. A deletion request with a portal image, an illustrative retained invoice, a provider/device copy and a backup. The privacy/finance reviewer must decide and record the applicable preservation basis; do not assume the invoice can be deleted or promise a fixed retention period.
4. A provider response and restored-backup re-deletion exercise, or explicit pending exceptions and owners if these cannot be performed. Simulated acknowledgements are not provider confirmations and a test restore is not production recovery acceptance.
5. A response and case closure only after authorised actions or documented exceptions are reviewed. Record the legal deadline and responsible owner only after they are confirmed.

**Outstanding:** mailbox receipt and assignment, staff-led end-to-end exercise, legal basis and deadlines, provider/device deletion, backup restore and re-deletion, real request handling and staff training remain unverified. Do not close PRIV-06, PRIV-08, PRIV-11 or P14 based on these tests. The Microsoft Clarity transition investigation remains separately open; no Microsoft contact was made as instructed.
