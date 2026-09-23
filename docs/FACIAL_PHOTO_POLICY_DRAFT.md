# Facial photo collection - working basis

Status: DRAFT - awaiting Liezl's review. Brett authorised interim collection settings on 23 September 2026. This is not legal approval.

## Source

Brett Dovey's email to Liezl Taylor, 23 September 2026 at 07:20 UTC, subject: STOR24 - legal approval required for facial access and photo retention. Retrieved from Outlook on 23 September 2026. This document summarises the email; it does not turn its open questions into approved settings.

## Workflow to retain

1. Customer signs the agreement and booking payment is verified.
2. Customer submits a photo privately through My STOR24 after seeing the notice and expressly consenting.
3. Photo waits for restricted staff review.
4. Staff confirm identity and move-in before provider activation.
5. Uploading or approving a photo alone never grants gate access.

## Draft notice structure for the owner's settings

- Purpose: prepare the customer's facial-access enrolment for their STOR24 facility.
- Explain the photograph, intended facial biometric, staff review, and separate HikCentral activation.
- Identify the responsible parties and providers after confirmation; do not invent hosting, cross-border or contractual facts.
- Show the chosen photo retention period and explain withdrawal/deletion accurately.
- Show the confirmed alternative-access contact/process.
- Require a separate affirmative consent choice; no pre-ticked consent.

This is a structure for customer-facing wording, not a finished privacy notice. The email asks Liezl to advise on the actual wording.

## Open settings (not supplied in the email)

| Setting | Working state |
| --- | --- |
| Portal photo retention | Active booking and tenancy; delete on cancellation, expiry, tenancy end or withdrawal |
| Alternative access contact/process | Facial enrolment required for precinct entry; contact facility manager for help; no alternative entry method currently configured |
| Customer-facing notice and consent wording | Interim v1 implemented in src/lib/facial-photo-control.ts; visibly awaiting review |
| Provider/device biometric retention and deletion deadlines | Awaiting Liezl and installed-provider confirmation |
| Consent-record/access-log/backup retention | Awaiting Liezl's review |
| Processing-party responsibilities, security incidents, hosting and cross-border arrangements | Awaiting confirmation |
| Additional authorised users and minors | Awaiting Liezl's review |
| Legal approval reference | Unset - must not substitute this email or owner authorisation for legal approval |

## Owner collection control

Requested: owner-controlled Enable photo collection switch, separate from training and Hikvision activation. Managers cannot enable it. The control should show draft/approval state and technical readiness, preserve an audit trail and version the notice/settings. Changes to consent terms require fresh consent rather than silently relabelling an earlier submission. Switching collection off stops new uploads, without stopping expiry/deletion work.

Existing encryption and recent expiry-maintenance checks remain required. Real Hikvision enrolment and physical access remain a separate unfinished integration and acceptance gate.

## Owner-authorised business rule - 23 September 2026

The seven-day period starts at confirmed debit-order failure, not its scheduled payment date or a pending result. Retries must not reset unresolved debt age. Suspension requires the debt still to be unpaid; restoration requires verified settlement of the relevant debt. Test payments must never affect live access.

This rule is recorded for the next provider work. Current batch integration reads load reports, not a final per-instruction settlement/failure feed; upload rejection is not a confirmed customer debit failure. Therefore this release does not fabricate failure dates or issue automatic gate suspension/restoration. Required work: verified final result ingestion, invoice/payment reconciliation, durable idempotent suspension/restoration scheduling and the installed Hikvision connector, followed by on-site acceptance.

## Implementation boundary

Owner switch is shared organisation-wide and pinned to the existing controlling owner. Managers see its current state and cannot change it. Turning it off blocks new/replacement uploads but retains consent, review and deletion. Interim policy versions/hashes are captured with consent; changes require fresh consent. Existing environment policies retain their fixed-hour expiry; interim submissions use booking/tenancy lifecycle retention (no arbitrary distant expiry date). Scheduled deletion continues while off. Portal deletion is not proof of HikCentral/device deletion.

No customer consent is preselected. Withdrawal remains available and does not promise an alternative entry method. Liezl's review, provider/device deletion, consent/audit/backup retention, minors and additional users remain open.

Deployment/test evidence belongs in PROJECT_CONTEXT.md. No email sent.
