# Staff event email review and activation

This workflow implements original Faeez item9. It is separate from customer communications, collection notices, financial approvals and the system-health OPERATIONS_ALERTS integration.

## Staff workflow

Open `/operations/event-emails` from the booking and move-in event inbox. Current database permissions and store assignments govern every request. Permission definitions are `staff_event_emails.view`, `.manage` and `.approve`, together with `operations.view`; this release assigns none of them to staff.

The preparer explicitly selects a store, up to five active existing staff recipients, actual event kinds, inclusive SAST source dates and an explicit SAST delivery window. Source and delivery windows are bounded to32days. There is no default recipient, event or schedule. Preview reads actual booking, signed-lease and tenancy-audit sources; source examples are bounded and remaining raw source positions can be evaluated in subsequent pages.

Retain for independent review encrypts the exact scope and sender configuration, binds them to an immutable policy fingerprint and writes a mandatory audit. Its UUID is an idempotency key. A different currently authorised reviewer supplies a reference before approval. Approval itself sends nothing. Staff, recipient addresses, store name, sender configuration and current source evidence are checked again at evaluation and immediately before dispatch. Changed or revoked authority holds the workflow.

Evaluate next source page creates a private encrypted outbox and sends nothing. Durable identity is organisation/store/source event/recipient user across all policies. Overlapping or repeated evaluations cannot create another message. Policies and outboxes have scoped stable older paging. No staff-email body is inserted into a customer's CommunicationLog or timeline.

## Activation gate

Default deployment leaves `STAFF_EVENT_EMAIL_ENABLED`, `STAFF_EVENT_EMAIL_APPROVED_FINGERPRINT` and `STAFF_EVENT_EMAIL_WORKER_KEY` unset. No cron or automatic invocation is installed by this release. Existing sender configuration alone does not activate this feature.

Before any activation, obtain Brett's explicit approval of the concrete named recipients, events, source dates, delivery timing, sender and independently reviewed policy. Existing role approval is not a delivery activation approval. Record approval evidence in PROJECT_CONTEXT.md and the operational tracker. Any necessary staff permission expansion also needs explicit approval.

Only after that approval may an authorised operator configure the enable switch to `true`, the exact reviewed policy fingerprint and a private worker key of at least32characters. Use the existing approved email provider and DLP policy. The protected `POST /api/internal/staff-event-emails` endpoint requires `Authorization: Bearer <worker key>`; never expose the key in a browser, URL, log or staff instruction. Scheduling the endpoint remains a separately approved deployment/configuration action.

Each invocation evaluates at most10raw source positions and claims at most10held notices. It checks actual source, current creator/reviewer/recipient/store authority, exact fingerprint and delivery window. The durable SENDING claim and audit commit before an external call. Existing email transport applies DLP and a15second provider deadline. Provider calls never occur inside a retriable database transaction, and no provider failure is automatically retried.

## Uncertain outcomes and cancellation

ACCEPTED records provider acceptance only; real inbox delivery and staff acceptance require separate evidence. An ambiguous provider exception records REVIEW_REQUIRED. A process crash or failed final outcome/audit may leave SENDING. Both states remain permanently excluded from automatic claiming. Never reset, delete, re-create or manually resend such a notice without an independently approved investigation of provider evidence and the original durable identity.

A held message with stale source/authority causes the worker to stop safely before sending; correct the source and obtain a new review where required. A previously retained source-recipient identity is deliberately not reissued through another policy. Cancellation stops future claims but cannot recall an attempted email. Do not interpret a cancelled policy as proof that a previously attempted message was not sent.

## Release evidence and remaining acceptance

Source, type/unit/PostgreSQL/browser and protected release results belong in the canonical dated context. Synthetic providers and localhost records do not establish actual staff email receipt. Live verification must first inspect the disabled page and ordinary current handbook download without creating policies, grants or sends. Actual named recipients, independent review, activation approval/configuration, provider acceptance, recipient inbox and staff teach-back remain distinct gates.
