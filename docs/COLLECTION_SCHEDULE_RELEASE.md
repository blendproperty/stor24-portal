# Scheduled collection letters

Brett explicitly selected **staff review each run** on15October2026. The native `/collections/schedules` workflow prepares a fresh current-South-African-day run; no prior policy or yesterday's approval authorises a regenerated future letter.

## Retained records and authority

`COLLECTION_SCHEDULE_PLAN` and `COLLECTION_SCHEDULE_RUN` are encrypted, namespaced HMAC-bound private ConfigurationProfile domains. Generic configuration cannot list or replace them. Immutable plans name one existing store, up to20 explicitly selected accounts, start/end days (up to93), weekdays, SAST due time and a15–720minute review/delivery window ending by midnight. These are engineering bounds, not an approved business cadence. There are no default recipients, dates, weekdays or timing.

New permission definitions are `collection_schedules.view`, `.manage` and `.approve`. No assignments are introduced. Read access also requires current `collections.view` at the same store. Management requires current `collections.manage`; independent run approval and dispatch also require current `billing.documents.send`. Every creator/reviewer role and store intersection is read from the database again. Faeez's separately authorised view/propose-only price grants remain unchanged.

Due evaluation creates at most one run per plan/day, reusing the existing account/day notice identity. Current source holds exclude the account; an earlier uncertain delivery also holds the next day. A draft already owned by another run is not rebound. Scheduled notices cannot be approved or sent via the manual endpoints. System preparation and dispatch audits have no invented human actor; the real policy creator and real run reviewer remain retained separately. Review is a genuine signed-in independent action over the exact recipients, subjects, full letters, revisions and run fingerprint. It approves all included notices atomically or none. Missing consent, a changed source, contributor self-approval or an expired window aborts review.

The retained run remains visible after expiry/cancellation. Review controls reflect actual retained contributors and current day/window; older runs stay collapsed until opened. There is no automatic regeneration of an approved run and no automatic same-day replacement of an immutable or uncertain notice. Investigate the retained source before a new explicit schedule; an unresolved attempted outcome must not be worked around by a different plan.

## Default-off worker

`POST /api/internal/collection-schedules` requires a dedicated strong Bearer key (`COLLECTION_SCHEDULE_WORKER_KEY`, at least32characters). Only this exact route uses the dedicated worker exception; surrounding staff/internal routes remain session protected.

All of the following remain unset until a separate explicit activation decision:

- `COLLECTION_SCHEDULE_ENABLED=true`
- `COLLECTION_SCHEDULE_APPROVED_FINGERPRINT=<exact retained plan fingerprint>`
- `COLLECTION_SCHEDULE_WORKER_KEY=<private strong key>`

No cron, key, policy, recipient, provider or role is activated by this release. The worker accepts exactly one retained active plan matching the fingerprint. It may prepare today's due run, but it never approves it. Only an independently approved current-day run can dispatch. Current creator/reviewer access, plan cancellation, sender credentials/configuration, source, consent, notice revision, real reviewer and window are checked inside the durable claim transaction and freshly before the provider call. Credential rotation is bound using the existing asynchronous memory-hard sender derivation.

Delivery uses the existing collection-notice producer: durable SENDING+communication evidence+audit before the provider, provider outside the database transaction, accepted versus inbox evidence distinguished, and no automatic reclaim/replay of SENDING or REVIEW_REQUIRED. Unknown completion of a database operation is not retried. Concurrent plans/runs/sends retain the same original account/day deduplication.

New collection letters retain redacted subject/text at claim and outcome persistence. History and all three exports release collection-letter text only where current communications-view and collections-view authority intersect at the actual message store. Delivery metadata stays visible within communications scope; ledger rows still require their separate financial permission. Restricted body text is also excluded from body-search/count inference and provider hydration, and collection access is checked again before file release. Historical missing content is not reconstructed.

## Release evidence and remaining gates

Local source validation on16October passed:885unit results/884pass/0fail/1existing optional skip;39actual isolated PostgreSQL scheduler/notice/history cases; type/full lint0errors8existing warnings;76guides319steps0writes/errors; native four-width and existing individual/group notice browser checks; production webpack build with152static pages. The19-page handbook is rendered and visually checked. Exact protected source checks, normal merge/deploy and genuine live disabled-page/handbook proof remain pending. Isolated fixtures and mock email-provider acceptance are not real customer sends or recipient inbox proof. Record final evidence in canonical PROJECT_CONTEXT.md and the original23 register before completion.

Real business timing/calendar/accounts/template acceptance, independent staff practice, explicit activation, actual provider/inbox outcomes, financial approval and training remain separate. No fees, lockout, account posting, SMS/WhatsApp arrears policy, bank activation or physical access changes are implemented or authorised by this schedule.
