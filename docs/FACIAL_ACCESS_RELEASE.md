# Private facial-photo queue and remaining access gates

22 September 2026. This release implements the private queue and staff handover boundary. **It does not complete the HikCentral access lifecycle or establish physical gate acceptance.**

## Implemented boundary

- My STOR24 uses its existing verified customer session. Booking references alone cannot authorise an upload, read or withdrawal. Eligibility is checked against the exact signed document, actual booking account, verified real payment and current booking/occupancy. Future move-in dates may queue photographs but cannot clear handover. Existing staff-confirmed move-ins may submit a photograph later.
- Authenticated multipart uploads have a real byte cap including chunked bodies. JPEG/PNG data is decoded with a pixel limit, oriented and re-encoded without EXIF. AES-256-GCM encryption binds ciphertext to the booking and photo version; images never enter public storage, exports, API lists, browser storage or the image optimiser.
- Consent text, the checkbox wording, policy hash/version, verified customer identity and consent time are recorded. New versions erase the prior ciphertext and invalidate approval. An unticked checkbox cannot submit.
- Staff require `access.manage` for private previews and decisions, and must have permission for that facility. Preview access is audited. Approval requires evidence that the same staff member opened that exact version. The displayed preview is cleared after at most one minute, on closure or following a review action. This does not prevent an authorised person taking a screenshot.
- Staff photo approval and staff move-in remain distinct. The locked handover transaction binds the reviewed photo to the resulting occupancy and persists `PENDING_PROVIDER`. Approval following an already-recorded handover does the same. The occupancy stays `PENDING`; no access-ready notification is sent. Repeated handover does not create another request.
- Withdrawal cancels the unprocessed activation intent and erases ciphertext. Rejection erases ciphertext. Expired, cancelled and closed/moved-out records are cleared by the retention worker, with deletion audits. Expired photographs cannot be viewed even before the next worker run.
- The old direct staff-upload enrolment endpoint is disabled, preventing that route bypassing customer consent and staff review or blindly repeating a partially completed provider enrolment. Existing shared-provider identities fail closed on revocation if another recorded active/pending grant exists. No existing production enrolments were found in the 22 September read-only check.
- HikCentral transport now checks a pinned certificate before sending the HTTP request, refuses redirects, bounds responses and requires an explicit provider success code. These transport checks are not evidence that any person, face or permission operation works on the installed system.

## Collection configuration — leave disabled pending legal approval

`FACIAL_ACCESS_POLICIES_JSON` is an organisation-ID-keyed object. No example in this file is an approved policy. Each enabled entry must contain all of:

- `enabled: true`, approved `version`, full `notice`, exact `consentLabel`, and `approvalReference`;
- an approved integer `retentionHours` (technical range 1–2160 hours; this is not a recommended retention period);
- approved `alternativeContact` instructions.

Missing or invalid configuration disables collection. The stable existing server encryption key must be available. Collection also requires a successful retention-worker heartbeat within the last 90 minutes. Disabling collection does not disable withdrawal or deletion.

Legal must approve the purpose/parties, notice and checkbox, genuine alternative, withdrawal procedure, queue/image retention, provider and device template retention/deletion, consent/audit-log retention, operator agreements and backup handling. Ciphertext deletion from the live database does **not** assert deletion from backups or HikCentral. Review access ends at `expiresAt`; physical deletion normally follows at the next five-minute worker run, and errors must be investigated. These timing and backup details must be reflected in the approved policy. Restored backups must have overdue records purged before customer collection is enabled.

## Retention worker

After deploying the release to the established VPS, run `bash scripts/install-facial-photo-worker.sh` as root in `/opt/stor24-crm`. This generates a separate random worker credential in `/etc/stor24/facial-photo-worker.env`, installs its digest in the application environment and recreates only the currently running app image. It installs `stor24-facial-photo-expiry.service` and `.timer`; it does not enable collection or change provider settings.

The runner uses the application's loopback port and puts the credential in curl stdin, not its command arguments. The exact `/api/v1/access/photos/expire` route accepts only this credential, not staff or customer sessions. It processes up to 100 due records per call; a remaining backlog is reported as failure for retry, and does not refresh the success heartbeat. Check the first run, timer state and database heartbeat. A failed timer, stale heartbeat or repeated backlog requires operator attention. The application rejects new uploads when the heartbeat is stale.

## Provider integration still required

There is intentionally **no consumer that sends the new activation intents to HikCentral**. The previous person/face/permission adapter is not a verified contract for the installed version and is not connected to this queue. A successful September door-list health check and saved mapping establish only connection/read configuration. Do not reconnect the old multi-call enrolment method as a shortcut.

Obtain the installed HikCentral Professional/OpenAPI version and its exact developer guide, approved test person/device/door, and provider confirmation of:

1. Person lookup by stable STOR24 identity, create/update semantics and duplicate handling.
2. Facial-image validation/enrolment, distribution status/readback and eventual completion/failure reporting.
3. Permission grant, suspension, restoration and revocation for the mapped doors; multiple units must preserve the union of the customer's valid access rights.
4. Removal of the face/template from server and each device, result verification, offline-device behaviour and retry/reconciliation rules.
5. Event timestamps/correlation and door-entry evidence, plus ownership between STOR24, HikCentral, MEL and any intermediary.

Then implement a durable, staged consumer that records intent before every provider mutation and the returned identity/result before progressing. Timeout/unknown outcomes must stop for readback reconciliation, never blindly replay person creation or permissions. Cancellation, expiry, policy change, replacement, transfer and move-out must supersede in-flight grants. Provider state and physical-entry evidence must remain separate. No staff-entered “verified” switch can replace provider/device evidence.

## Final acceptance at Midpoint

Use an expressly consenting test participant and an authorised staff operator at the actual gate. Record provider event IDs, device/door, timestamps and the operator's observed result without adding a facial image to the test report.

| Test | Required result | Current evidence |
|---|---|---|
| Private upload, isolation, replacement and expiry | Only correct customer/staff scope; stale approval rejected; ciphertext erased | Automated, isolated synthetic-image tests |
| Signed/paid booking and staff handover | One occupancy and one pending request; no automatic gate activation | Automated PostgreSQL tests |
| Enrol and distribute | One stable person; correct face and door permission; device confirmation | Not run; provider consumer not implemented |
| Actual entry | Consenting participant can enter only the agreed door | Not run; on-site operator required |
| Suspend | Same participant is refused after confirmed suspension | Not run |
| Restore | Entry works again after confirmed restoration | Not run |
| Revoke / move-out / consent withdrawal | Entry refused; remaining valid units unaffected | Not run |
| Biometric erasure | Provider and device deletion confirmed separately from revocation | Not run |
| Timeout / duplicate / offline device | No duplicated person or false active state; deterministic recovery | Consumer not implemented |

The broader “Move-in and physical access” item stays open until these provider, legal and physical acceptance gates are closed. Training and operational approval also remain open.
