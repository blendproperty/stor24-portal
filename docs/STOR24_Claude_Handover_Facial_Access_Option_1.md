# STOR24: Claude implementation handover — Option 1 facial access

Prepared: 16 September 2026, Africa/Johannesburg.
Owner/requester: Brett Dovey, Blend Property Management.
Decision: Mark Corbishley selected Option 1, as explicitly reported by Brett in this conversation.
Status: requirements and source-code review only. This document does not establish implementation, deployment, biometric enrolment, or production acceptance.

## 1. Instruction to Claude

Implement the selected **self-service facial-photo capture with staff-confirmed tenancy activation** workflow in the existing STOR24 platform. Read this document and the current canonical PROJECT_CONTEXT.md in both repositories before changing code. Inspect the current implementation first, preserve working booking/payment/signing flows, then implement and validate the gaps.

The customer completes the existing online reservation, identity/contact verification, signed agreement and verified payment, then takes/uploads a facial photo with explicit consent. STOR24 securely queues that photo. An authorised staff member reviews the booking and clicks **Move In**. Only after that checkpoint may the tenancy activate and the photo be submitted to HikCentral for enrolment and the correct facility permissions. Show access as ready only after the provider confirms success.

Do not implement Option 2 (automatic activation if the unit is Available) or Option 3 (unconditional automatic activation). Do not silently turn Move In into a bypass of payment, agreement, consent, scope, or provider checks.

This is a full implementation brief, not a request to create another standalone facial-access application. The public customer journey and existing CRM must work together.

## 2. Decision evidence and source hierarchy

### Confirmed business decision

Brett said: “so look at the mail sent to mark regards the facial access he wants to go with option 1”. Treat this as the selection of Option 1. A separate reply from Mark was not retrieved; do not claim one was read.

Sent email reviewed in Outlook:
- Subject: **STOR 24 | Decision required: tenant facial access and onboarding**.
- From Brett Dovey to Mark Corbishley, 16 September 2026 at 10:15:50 SAST.
- Option 1 wording: “Staff-confirmed activation: the customer submits their photo online, but access waits for staff to click ‘Move In’. This retains the staff checkpoint, although a paid tenant can still be left waiting.”
- Attachment: **STOR24_Access_Options_For_Mark.pdf**, one page, downloaded from that exact sent message and visually reviewed. A copy accompanies this Markdown file.

The attachment's Option 1 sequence is: Reserve unit online → Verify mobile & email → Sign lease & pay → Take/upload selfie → Photo stored, queued → Staff clicks Move In → Photo sent to HikCentral → Facial access is live.

The attachment identifies the waiting period before staff action as a downside and calls for consent, purpose limitation, restricted access, retention and deletion handling. Treat its legal wording as stakeholder context, not a legal opinion or proof that a compliant policy is already approved. Capturing a selfie is not identity verification or liveness detection.

### Interpretation versus approval

The staff checkpoint and queued self-service capture are approved through Brett's selection. Technical designs, suggested labels, retry policies and queue design below are implementation requirements/recommendations derived from that selection. Exact retention periods, service-level commitments, alternative-access procedures and any commercial policy changes remain owner decisions. Do not invent their approval.

## 3. Repositories, baseline and safe starting point

| Repository | Responsibility | Mainline | Reviewed baseline |
|---|---|---|---|
| blendproperty/stor24-portal | CRM, booking records, agreements, verified payments, occupancy, consent, staff activation, HikCentral integration | main | 4df6aae (16 September refresh); runtime files inspected at e67be3c; intervening change adds booking race tests only |
| blendproperty/stor24 | Public website and booking/customer experience; server-side CRM proxy | master | 34d48ac8b44584131158c2d58f1d449441abc7eb |

Known local locations:
- CRM: `C:\Users\BrettDovey\OneDrive - Blend Property Management\Documents\Sitelink\stor24-crm-remote`.
- Public: `C:\Users\BrettDovey\OneDrive - Blend Property Management\Documents\Stor24`.
- Public runtime URL identified in project context: `https://stor4.srv938083.hstgr.cloud`.
- CRM runtime URL identified in project context: `https://stor24-site.srv938083.hstgr.cloud`.

Refresh remote heads and verify actual deployment targets before implementation or deployment. These are inspection baselines, not proof of running container versions. The legacy `stor24.co.za` domain did not serve the current booking API during this session; do not assume it is the correct application target.

The existing CRM checkout is on a stale branch with an unrelated modified PROJECT_CONTEXT.md and untracked `stor24-pwa/`. The public checkout is behind mainline and has a modified tsconfig.json. Preserve these changes. Use a clean worktree from current remote mainline. Read repository AGENTS.md and installed Next.js guidance before editing.

## 4. What exists today, and what is missing

### Staff facial enrolment exists

`src/app/access/page.tsx` and `src/components/biometric-access-workspace.tsx` provide a staff enrolment screen. `src/app/api/v1/access/biometrics/route.ts` accepts a JPEG/PNG File, facility/customer/occupancy identifiers and consent, gated by access permissions and scope. `src/lib/biometric-access-service.ts`:
- Requires an occupancy in ACTIVE or NOTICE_GIVEN status matching the customer/facility/organisation.
- Validates JPEG/PNG MIME type and a 5 MB maximum.
- Hashes the image, calls HikCentral and stores a hash rather than retaining the raw uploaded photo.
- Upserts a BiometricEnrollment by occupancy and purpose.
- Marks enrolment and occupancy access ACTIVE only after the provider reports success.
- Attempts the existing ACCESS_READY WhatsApp template with communication consent and an idempotency key.
- Provides revocation; the existing documentation describes move-out using that path.

`src/lib/integrations/hikcentral-provider.ts` currently performs person creation, face upload and permission assignment sequentially. Partial failure, duplicate person handling and uncertain network outcomes must be reviewed before enabling queued retries. The inspected provider revoke method removes permissions; this is not proof that face/person records are deleted.

### The self-service queue is new work

The existing architecture document says the public website/CMS do not process or store face images in that release. Option 1 deliberately changes this: a photo must survive the gap between online submission and staff action. A SHA-256 digest cannot recreate the photo. Browser memory, localStorage or a digest-only database field cannot implement the queue.

Add an explicitly designed private, durable, temporary image store with authenticated access, lifecycle cleanup and consent evidence. Update the old documentation so the new limited handling is accurately described. Do not put biometric files in public CMS media or Git.

### Move In is not already the required conversion flow

`src/lib/leasing-service.ts:moveIn` currently creates a new account, DRAFT tenancy, PENDING occupancy and a pending lease document, reserves the unit, optionally posts an initial charge and marks a linked reservation CONVERTED. Other signing paths activate tenancy/occupancy after signature.

Consequently, attaching facial enrolment to the existing button without reconciling this flow can send an already-signed customer through another agreement or create duplicate accounts/charges. Inspect both the reservation-agreement flow and tenancy-document flow. Preserve valid signed evidence and existing payment/account links. If the booking agreement is legally distinct from the final lease, raise that specific contract question; never silently equate them or demand an unnecessary second signature.

The 16 September investigation addendum reports an empty active-tenancy enrolment selector because no moved-in tenancies existed in that inspection. It reports signed reservations, not completed tenancy activation. This is historical investigation evidence, not a fresh live database count. Do not “fix” it by allowing arbitrary reservations into the existing privileged enrolment endpoint.

### HikCentral readiness is partial

The 15 September addendum records a successful connection test after changing health checks to the unscoped `acsDoorList` endpoint. It also records unresolved facility organisation/door mappings and no meaningful production enrol/revoke acceptance. A successful health check or door listing is not proof of correct door authorisation, face distribution or physical access. Recheck current configuration without exposing secrets. Never reuse placeholder organisation or generic park-door mappings for a customer grant.

### MEL and access governance

The inspected `access-decision-service.ts` separates desired decisions from provider-confirmed execution, rejects test/merchandise-driven grants, and restricts MEL authority. Its comments explicitly say it is not yet wired into the existing biometric enrol/revoke paths. MEL provider scaffolding is not evidence of a functioning integration.

STOR24 owns the staff/commercial entitlement decision. Reuse the present HikCentral integration; do not redirect enrolment through MEL or build a replacement system as part of this change. Inspect current MEL ownership documents and preserve IntegrationLinkID identity relationships. Do not match people by display name/email/mobile to merge identities. Do not treat a stale comment claiming verified enrol/revoke as stronger evidence than actual test records.

## 5. Required customer journey

1. Preserve unit selection, verification, agreement and payment flows.
2. Offer **Set up facial access** only when the server confirms the exact customer's agreement is signed and the required payment is verified. A payment return URL, query parameter, frontend flag, pending EFT, mandate setup or test payment is not cleared payment.
3. Support mobile camera capture and JPEG/PNG upload fallback, with preview, retake/replace and clear instructions. Handle denied camera permission and unsupported devices. Validate server-side, including actual decodable content and bounded dimensions/decompressed size, rather than trusting MIME headers alone.
4. Present the approved purpose/consent notice and explicit unticked consent control. Store policy version, timestamp, authenticated customer identity, reservation/facility link and necessary evidence. Do not attribute customer consent to a fabricated staff actor.
5. Persist the validated image privately and create/update a reservation-bound submission. A returning customer must see the real server status after reload or on another device.
6. Show **Photo received — awaiting staff activation**. State clearly that submitting the photo does not yet permit entry. Give the configured support contact without inventing activation times.
7. After staff approval, show **Facial access is being set up** while provider work is pending. On recoverable failure, show that staff are resolving it or request a replacement photo when appropriate; do not expose provider internals.
8. Show **Facial access ready** and send the permitted notification only after confirmed provider enrolment/permission success. If terminal distribution is asynchronous, represent it separately and do not claim physical access is proven by API acceptance alone.

The photo must belong to the authorised account/customer and specific reservation, not simply whoever possesses a guessable booking reference. Preserve existing customer/session verification. Do not accept an arbitrary client-supplied customerId as authority.

## 6. Staff review and Move In

Expose a practical pending-activation queue in the existing CRM, linked to the reservation/customer and Move In flow. Show store, unit, intended start date, agreement state, verified payment state, consent/photo state, wait age, blockers and access outcome. Restrict any photo preview to authorised staff and audit viewing where appropriate.

Before staff activation, recheck on the server:
- Staff permission, organisation and facility scope.
- Exact customer/reservation/unit relationship, current reservation validity and exclusive unit claim.
- Valid signed agreement evidence and real qualifying payment; test and merchandise payments are excluded.
- Unit readiness and permitted start date/time; a future start date must not accidentally grant early access.
- Current consent, usable submitted photo and no cancellation, revocation or superseding submission.
- Approved HikCentral facility/door mapping and operational provisioning prerequisites.

Clicking Move In records who approved what, when, and against which submission version. It must atomically convert/reuse the proper booking records, preserve agreement/payment/account lineage and create one durable provisioning job. Separate database transactions from external provider calls. Do not require a second manual upload on the Facial access page after successful customer submission.

Recommended failure model: tenancy conversion and biometric access have separate statuses. A committed move-in with a provider failure remains clearly marked **access pending/failed**, with a safe retry; it must not falsely imply a rollback of external actions or mark access ACTIVE. Keep billing/start-date policy explicit if access is delayed; do not invent refunds, rent starts or compensation rules.

Staff can request a new photo, retry a failed provision and see an actionable configuration failure. Repeated clicks, retries, concurrent staff and browser refreshes must not create a second tenancy/account/charge/enrolment or repeat customer notifications.

## 7. State and persistence design

The names below are conceptual, not a mandate to add parallel enums where existing models suffice.

| State | Meaning | Provider grant allowed? |
|---|---|---|
| Not eligible | Agreement/payment/customer requirements incomplete | No |
| Photo required | Eligible signup; no valid consented submission | No |
| Awaiting staff | Valid photo/consent securely queued | No |
| Provisioning | Staff approval durably recorded; provider task running | Only the approved scoped task |
| Access ready | Required provider stages confirmed | Yes, for approved doors/time only |
| Failed / reconciliation required | Explicit failure or unknown external result | Never infer success; inspect/retry safely |
| Revoked / cancelled / expired | Entitlement removed or submission no longer valid | No new grant |

Before occupancy creation, bind submission to reservation/customer/facility/organisation. After conversion, retain that history and link the resulting tenancy/occupancy/enrolment. Suggested persisted metadata: private object key, content type/size/hash, submission version, consent version/time, expiry, approval actor/time, correlation/idempotency key, provider stages/references, last error and retry timing. Never log image bytes/base64 or public image URLs.

Use a durable outbox/worker or equivalent recoverable mechanism. Define bounded retry/backoff, recover abandoned jobs and distinguish terminal photo errors from configuration failures and transient provider errors. Revalidate entitlement immediately before granting permission and prevent cancellation or a newer revocation from being overtaken by an older job.

If person creation succeeds but face upload fails, retain/reconcile the person identity. If permission assignment may have succeeded but the response was lost, read back provider state before repeating. Never create unlimited duplicate people or leave unknown grants untracked. Consider that the existing person code is customer-derived, so customers with multiple occupancies require facility-aware permission aggregation: ending one unit must not wrongly revoke another valid tenancy or retain doors with no remaining entitlement.

## 8. Privacy and operational controls

Implement private encrypted storage, TLS, least-privilege access, narrowly scoped short-lived authenticated preview/download, cache prevention and safe logs. Strip unnecessary image metadata and validate any image transformation against provider requirements. Keep secrets server-side. Never store photos in browser persistence, analytics, public URLs, email attachments, source control or general audit payloads.

Specify and obtain owner approval for queued-photo expiry and post-success deletion, failed/cancelled booking cleanup, replacement-photo deletion, backup retention and provider-side deletion/correction. A scheduled cleanup job needs operational evidence; writing a retention timestamp is not deletion. Revoking door permissions is not biometric erasure. Preserve non-image evidence needed for audit without retaining raw photos indefinitely.

Provide an operational non-biometric alternative/escalation for refusal, inability to capture, accessibility needs and repeated rejection; its exact process needs business confirmation. Do not claim face matching against an ID, liveness, anti-spoofing or fraud prevention unless a separate verified capability is implemented and scoped.

Use existing permitted communication channels and preferences. Payment confirmation must never say access is active. Notification failure after successful provisioning must not rerun enrolment. Add staff visibility/escalation for old queued items without inventing a promised SLA.

## 9. Code navigation

CRM paths to inspect (relative to blendproperty/stor24-portal):
- `prisma/schema.prisma` and additive migrations: Reservation, tenancy/occupancy, agreements, payments/accounts, BiometricEnrollment, access decisions, identity links and audit/outbox models.
- `src/lib/leasing-service.ts`, `src/components/move-in-workspace.tsx`, `src/app/operations/move-in/page.tsx`.
- `src/app/api/v1/leasing/workflows/[action]/route.ts` and relevant permission/validator modules.
- `src/lib/public-booking-service.ts`, `src/lib/public-booking-contract.ts`, public reservation/signing/payment endpoints.
- `src/app/api/public/v1/lease-signing/reservation/[token]/route.ts` and the separate tenancy signing/webhook paths.
- `src/lib/public-netcash-payment.ts`, `src/lib/payments/netcash-service.ts`, `src/lib/payments/netcash-reconciliation.ts`.
- `src/lib/tenant-portal-auth.ts`, `src/lib/tenant-portal-security.ts`, tenant routes and owned-account lookups.
- `src/app/access/page.tsx`, `src/components/biometric-access-workspace.tsx`, `src/app/api/v1/access/biometrics/route.ts`, `src/lib/biometric-access-service.ts`.
- `src/lib/integrations/hikcentral-provider.ts`, `hikcentral-configuration.ts`, `hikcentral-readiness.ts`.
- `src/lib/access-decision-service.ts`, `src/lib/integrations/mel-provider.ts`, `src/lib/mel-integration-status-service.ts`.
- `tests/reservation-move-in-handoff.test.ts`, `tests/public-booking.test.ts`, `tests/hikcentral-provider.test.ts`, `tests/hikcentral-readiness.test.ts`.
- `docs/HIKCENTRAL_BIOMETRIC_ACCESS.md`, `docs/HIKCENTRAL_FIX_2026-09-15.md`, `docs/2026-09-16-facial-access-padding-and-move-in-gap.md`, MEL ownership/handover documents, current UAT checklist and PROJECT_CONTEXT.md.

Public paths to inspect (relative to blendproperty/stor24):
- `app/components/booking/UnitFinder.tsx`, `app/lib/portal.ts`.
- `app/api/booking/` reservation, payment return/status and proxy routes; trace actual mounted components before adding new routes.
- Existing booking confirmation/return and customer portal handoff; preserve authentication and server-only API credentials.

## 10. Acceptance tests and evidence

### Automated behaviour and integration tests

1. Signed/paid verified customer can submit a valid consented photo; no tenancy activation, person creation or permission grant occurs before staff approval.
2. Unsigned, unpaid, pending/failed payment, forged return URL, expired/cancelled booking and wrong-owner/wrong-facility submissions are denied.
3. Test/sandbox/R10 payment and merchandise-only purchase cannot qualify a production activation. A mandate alone is not settlement.
4. Camera/upload/retake/reload/resume works; invalid MIME/content, empty/oversized/decompression-heavy images and missing consent fail safely.
5. Two staff clicks/concurrent workers produce one conversion and one effective grant. The same signed agreement/payment remain linked; no duplicate invoice, charge, account or unnecessary lease is created.
6. Already reserved units remain protected for their exact booking; competing booking and activation are tested using database transactions, not only source-string assertions.
7. Partial provider success, duplicate person, rejected face, wrong configuration, timeout, lost response and restart are recoverable and never displayed as access ready prematurely.
8. Cancellation/consent withdrawal/photo replacement/move-out racing queued provisioning cannot produce a stale grant. Multiple valid occupancies retain only their legitimate combined permissions.
9. Unauthorized staff/customer photo access fails; bytes/base64/object URLs are absent from logs, public API responses and analytics.
10. Cleanup actually removes expired/replaced/successfully processed raw photos according to approved policy; revoked access and biometric deletion are verified separately.
11. Notifications are state-accurate and idempotent; a failed notification cannot cause duplicate enrolment.
12. Existing staff manual enrolment, revocation, transfers, move-out, booking, signature, payment and non-biometric workflows retain expected behaviour.

### Browser and provider acceptance

Test phone and desktop camera/upload fallback, denied camera access, page reload and another-device resume; test the staff queue and Move In without manual re-upload. Use isolated fixtures first. A real enrolment test needs an explicitly authorised profile and confirmed doors; this document does not authorise enrolling a customer, charging money or granting access.

For controlled live UAT, record agreement/payment provenance, staff approval, one tenancy/occupancy, provider person/face/permission readback, intended terminal receipt, actual allowed entry and denied entry after revocation. Confirm unrelated doors are not granted. Capture redacted evidence; never put biometric images or credentials into the handover, Git or screenshots intended for broad sharing.

Build, CI success, HTTP 200 and “Test connection” are insufficient evidence of operational facial access. Report each evidence layer separately.

## 11. Implementation sequence

1. Refresh both repositories, inspect context and current live configuration evidence read-only; document drift from this baseline.
2. Trace reservation signing/payment/account conversion and provider lifecycle. Resolve the already-signed agreement handoff before adding a shortcut.
3. Add backward-compatible submission/storage/consent/job schema and controlled feature configuration. Do not bulk-enrol or auto-convert existing bookings.
4. Implement owned-customer capture/upload and pending status; implement staff review and guarded Move In; integrate durable provider provisioning and retries.
5. Add deletion/reconciliation/notification handling, update the existing facial-access register and operational queue.
6. Run appropriate automated and migration-backed tests and browser checks, then prepare a reviewable PR with remaining provider/privacy/UAT gates.
7. Deploy only through the repository's authorised process, preserving production configuration and disabled gates until approved. Never work around an actual approval denial.
8. Conduct separately authorised live enrol/revoke UAT and reconcile documentation before claiming completion.

## 12. Unresolved owner/provider decisions

- Exact retention periods, deletion process and approved consent notice.
- Final facility organisation/door mapping, provider path/version semantics, distribution/readback and deletion capability.
- Whether the already-signed public agreement is the legally sufficient lease for conversion; preserve existing evidence while resolving any distinction.
- Qualifying payment rules for EFT/debit-order/other cases, intended move-in time, and accounting treatment while access is delayed.
- Staff responsibility/coverage, escalation threshold, alternative access and exception process.

These do not undo Mark's Option 1 selection. Implement the verified technical scope while making genuinely unresolved decisions visible. Do not silently substitute automatic activation.

## 13. Completion and reporting contract

Brett's permanent project rule: after relevant validation, update canonical **PROJECT_CONTEXT.md in every affected repository** before final handoff. Record the date and evidence, separately covering implementation; testing; commit and push; merge; deployment and configuration; live production verification. Preserve all outstanding provider, data, privacy/legal, finance, training, UAT and approval gates. Verify context is present on the intended remote branch. Reconcile Asana if it is part of the implementation scope.

Deliver working code and migrations, tests/results, updated architecture/operations/privacy documentation, deployment/rollback instructions, and a concise account of remaining gates. Give exact commit/PR/deployment evidence. Do not call code-only, simulated or partly tested work production-complete.

### Status of this handover itself

- Implementation: this requirements document only; no runtime changes or policy enablement.
- Validation: sent email and its one-page attachment reviewed; key current remote source paths and gaps checked; document checked for completeness and accidental secrets.
- Commit/push: documentation branches are prepared separately from existing dirty checkouts; verify final Git evidence in accompanying context entries.
- Merge: not requested/performed for this handover.
- Deployment/configuration: none.
- Live production verification: no new biometric enrolment, Move In, payment or door test performed. Historical addenda are explicitly labelled as such.

The outdoor-unit sizing and pricing discussion earlier in Brett's conversation is unrelated and excluded from this facial-access requirement.
