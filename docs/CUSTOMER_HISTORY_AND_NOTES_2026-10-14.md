# Shared customer history and staff notes

14 October 2026. Implements the customer timeline/notebook portion of Faeez meeting items4–6,8 and15. This record does not close staff acceptance or the wider reminder/handover/export gaps.

## Staff workflow

Open Customers & tenants and select a customer. Customer history & staff notes shows newest-first notes, existing collections activity and linked email/SMS/WhatsApp records. Dates use Africa/Johannesburg with an explicit SAST label. Load older history continues beyond the previous latest100 global-message limit. Filter the timeline by history type, note category and text; communication search matches stored message type/channel. A note-category filter restricts results to staff notes.

Choose the customer's store, category and enter a note. Categories: General, Phone call, Customer message, Payment follow-up, Move-in, Move-out request, Complaint and Staff handover. The server records the author name and time; no client author/date can be supplied. Notes cannot be edited or individually deleted. Add a new correction referencing the earlier note. Two authorised staff at the same store read the same entries. Existing undated profile-summary text is preserved and labelled honestly.

A payment-follow-up note neither posts a financial adjustment nor schedules a reminder. Move-out notes do not submit a move-out. A handover note records the information; named ownership/acknowledgement and appointment reminders remain separate work.

## Access, delivery evidence and integrity

- operations.view governs the customer and note read scope; operations.manage governs adding notes. Faeez's configured Midpoint role already has these grants. No role or financial approval changes are needed.
- Collections and communications keep their separate view grants, intersected with the customer-page store scope. Missing source grants are explicitly shown; shared multi-store customers do not expose another store's notebook, collection activity or facility-assigned communications.
- Historical communications without a store follow the existing visible-customer rule and are labelled Store not recorded. Unlinked customers remain creator-only until linked, following existing customer rules.
- Communications return only selected channel/direction/type/status and recorded sent/delivered/read times. Raw payloads, recipient hashes, provider tokens, secure links and failure details are excluded. PENDING/provider acceptance is not fabricated as delivered/read. Complete message bodies and external chat transcripts are not supplied where the provider log does not store them.
- Notes plus the audit commit atomically. Per-customer request keys, immutable payload/author checking and a customer row lock make concurrent duplicate/retry saves return the same note. An uncertain UI save locks its input and retries the same reference. Reads fail closed on access loss; customer switching aborts previous requests.
- Ordinary customer deletion is blocked once notebook history exists. The separately confirmed organisation UAT reset retains its existing customer-data removal behaviour; its preview now counts the notes. No live deletion/reset is performed by this implementation.

## Validation and promotion

Local validation: schema generation/validation, final typecheck and changed-source lint passed. Four focused policy/HTTP/staff boundary checks passed. Full local suite:770 results,769 passed, zero failures, one existing optional visual skip. Actual history component tests passed at1440/390/320 including SAST display, category/paging, uncertain/duplicate/timeout saves, input retention, denied/malformed reads, customer switching and no overflow;320px visual reviewed. Existing customer read/save recovery fixtures also passed at all three widths.

The additive CustomerNote migration has no backfill and preserves existing Customer.notes and collection/message records. Isolated PostgreSQL CI adds two-writer/retry, audit rollback, author snapshot, covering-staff visibility, organisation/store/source isolation, safe projections, mixed timestamp-tie pagination through115 events, filtering, finance/provider non-mutation, creator-only unlinked records and UAT reset/history deletion regressions. Local Docker is not running; those database checks require the protected CI service.

Commit/push: prepared on codex/customer-history-notes-20261014 from main8347a65. Merge, production migration/deployment and live route verification remain pending at this checkpoint. Do not claim staff login, covering-staff workflow acceptance, actual historical message completeness, inbox delivery, customer transcript sync, appointment scheduling, acknowledged handover or customer-specific contact export. All existing legal/privacy/finance/provider/data/device/training/approval gates remain open.
