# Additional authorised people — implementation draft

13 November 2026. Nominations and supervised additional-person photo capture and review are deployed with collection held by policy. They are not configured for live biometric collection or connected to HikCentral.

## Configuration boundary

Additional-person collection is disabled unless an organisation-specific entry exists in `ADDITIONAL_ACCESS_POLICIES_JSON` with `enabled: true`, a version, notice, consent label, approval reference and a retention period in hours. This is separate from the primary-customer policy. No approved wording or production setting is supplied here. The collection also requires the existing encryption key and a recent successful expiry-worker heartbeat. Configuration does not itself constitute legal approval or activate access.

`ADDITIONAL_PERSON_FACIAL_NOTICE_FOR_APPROVAL.md` contains proposed person-facing wording and an explicit decision list for Liezl and the precinct operator. It is a draft and supplies no approval reference or live setting.

Staff must have access management permission for the facility. The screen requires a witnessed confirmation that the nominated person is present and has accepted the displayed notice; the checkbox records the staff operator's attestation, not independent identity verification. Photographs are encrypted and version-bound, removed on withdrawal or rejection and processed by the expiry worker. These controls still require independent review and real staff acceptance before use.

## Required behaviour

An authorised tenant may nominate multiple people for a booking/unit. Each person requires a separate identity, personal consent record, photo submission, review, access status and withdrawal/removal lifecycle. A nomination or photo approval must never be represented as active HikCentral or physical access. A person's removal must not revoke another person's access, including access to another active unit. The primary customer's existing photo and handover must continue to work independently.

## Portal implementation boundaries

- Replace the single-person assumption without invalidating existing reservation photo records, consent versions, encryption bindings, review audits or handover lookups. Backfill existing records as the primary customer; use a stable separate person identifier for each additional person and versioned encryption associated data.
- A customer nomination is not evidence that the nominated person has consented. Provide a separately authenticated or supervised consent process whose notice, lawful basis, withdrawal path and retention are approved for additional users; do not reuse the primary tenant's checkbox as their consent. Keep collection disabled for this feature until the approved policy is configured.
- Apply organisation, facility and booking scope to every list, upload, preview, review, withdrawal and removal. Verify the booking holder's authority to nominate a person and the person's identity before provisioning. Enforce request size, decoded image limits, encryption, private previews and audit requirements equivalent to the existing queue.
- Extend the retention worker, cancellation, move-out, policy changes, withdrawal, replacement and deletion to all people independently. Prevent race conditions between those operations and any later provider request. Preserve version-specific review and reject stale approvals. Handle existing backups and provider/device deletion separately.
- Present each person and their status separately. Staff review does not grant access. Clearly show pending provider and onsite verification; never report active access based only on photo capture or a provider request.

## HikCentral integration gate

The existing provider consumer is not implemented for the installed system. Obtain the installed HikCentral/OpenAPI version, the exact provider API contract, the confirmed organisation and door mappings, and an approved test person and access point. Implement durable per-person provider intent, stable identities, grant and readback, distribution, suspension, restoration, revocation, device deletion, retries and unknown-outcome reconciliation. Confirm that multiple people can be assigned the intended shared entrance and, where applicable, the unit door. Follow `FACIAL_ACCESS_RELEASE.md`; do not reconnect the old unverified adapter.

## Required validation

Use synthetic data for automated tests covering two people on one booking, a person with multiple valid unit grants, primary-photo compatibility, tenant/facility isolation, individual consent and withdrawal, stale review, replacement, expiration, move-out, simultaneous operations and deletion. Verify no provider mutation and no access-active claim while the provider gate is held. After provider contract and privacy decisions are approved, conduct a controlled end-to-end test with a consenting participant and an authorised operator at the actual access point, including independent removal and confirmation that other people's access remains intact.

## Status

The tablet capture-to-review code was merged in PR #803 and automatically deployed by guarded run 43409597636 for `da93206ee4608e6c795037220cea5aca1eac5b0c` on 13 November 2026; see PROJECT_CONTEXT.md for dated evidence. The separate notice remains a draft, `ADDITIONAL_ACCESS_POLICIES_JSON` was not enabled by this release, and no HikCentral or door mapping was changed. A live expired-link page and public health response were checked, but real photo collection, runtime role privileges on the new table, provider enrolment, reader entry/removal and staff UAT were not verified. Legal/privacy review, alternative entry, provider retention/deletion, physical installation, training and business acceptance remain open. This draft does not authorise collecting real additional-user biometric data or changing physical access.
