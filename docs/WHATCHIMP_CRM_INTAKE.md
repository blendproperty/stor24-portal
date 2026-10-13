# STOR24 WhatChimp enquiry capture

Separate bot: `475943`, number ending `6824`. Existing Twilio verification and transactional sender ending `1324` is outside this integration.

## Intake contract

`POST /api/integrations/whatchimp/enquiry`, JSON body, `Authorization: Bearer <dedicated intake key>`. The key is scoped to one configured organisation, facility and bot; the caller cannot choose organisation/facility. Only its SHA-256 digest is stored in a `WHATCHIMP_INTAKE` / `bot475943` configuration profile. No customer/tenant lookup API or account access is granted. Profile configuration: `enabled`, `botId`, `keyHash`, `facilityId`; status must be `READY`.

- `probe`: botId only. Confirms the connection/calendar without creating a lead. Returned enquiryKey/reference are explicitly connection-test fixtures.
- `start`: botId, phone, optional displayName. Creates or reuses an unfinished enquiry and returns enquiryKey. The prospect has no invented email or verified identity.
- `update`: botId, phone, enquiryKey, field, value. Saves one of use/items/start/duration/size/viewing/name. Seven individually bounded fields; the key and phone must match the saved enquiry. Repeated identical answers are safe. Submitted enquiries cannot be silently edited.
- `submit`: botId, phone, enquiryKey. Requires all seven answers. Creates one follow-up task and returns the current routing decision. Retries do not duplicate the lead/task.
- `route`: botId, phone, optional enquiryKey. Captures a direct request for staff, even without a completed questionnaire. Reuses the customer's latest WhatChimp enquiry; unresolved/empty optional provider key is treated as absent.

Responses: `ok`, `enquiryKey`, `leadReference`, `phase`, `routing` (`STAFF`, `AFTER_HOURS`, `HOURS_REVIEW`), `staffed`, `nextOpening`, `timezone`, `message`. Only a successful response permits a saved/received customer acknowledgement. Before each API call, reset the provider checkpoint to a number; map phase back into that field and require the expected literal START/SAVE_USE/etc/SUBMITTED/ROUTED before advancing. A failed API cannot reuse a prior success marker. Failures must offer retry/manual assistance and must not say the enquiry reached CRM. Native reset/condition behavior still requires provider readback and UAT.

## Progressive bot flow

Use a start HTTP call, then seven single-question User Input campaigns. Each final reply connects to its field's update HTTP call before the next campaign. Map enquiryKey from start into a dedicated provider field and preserve it for updates/submission. This avoids relying on undocumented incoming-message payloads or receiving every unrelated customer message. Existing answer fields77749-77755 are retained.

After the review's send action, submit to CRM and branch on routing. During saved working hours, offer native human support in Omnichannel; after hours, show the returned receipt, offer menu/booking and queue the normal NEW lead/follow-up. Direct staff shortcuts must call route before acknowledging capture. Never interpret a bot reply as a human response for SLA reporting.

## Hours and operations

Calendar is read on each request from the facility's saved Enquiry response SLA policy. Saved store office hours are the fallback; example hours are never used. South Africa time (+02:00), saved holidays and next opening are respected. Missing/invalid calendar queues for review and never promises an available agent. Edit the existing backend Settings / Enquiry response SLA or store office hours; do not maintain a separate provider calendar.

Lead source is WhatsApp and stage starts NEW, with a linked prospect. Progressive notes contain the answer summary and Omnichannel conversation link. Existing staff notes/stage/booking state are preserved. No unit, lease, payment, OTP or notification is created by intake. Staff continue in the existing lead-to-lease workflow. Follow-up tasks and provider enquiry session state are durable and scoped; disabling the profile revokes capture.

## Validation and release gates

Candidate implementation13October2026. Local npm installation failed because the disk filled; local tests are not claimed passed. Protected Linux CI includes the calendar/contract unit tests and an isolated PostgreSQL test of concurrency, incremental save, scope binding, incomplete/submitted protection, preserved staff notes/stage, after-hours tasks, changed calendars, disablement and no reservations/communications. Provider/API activation, seven native campaign/API connections, failure branches, actual progressive capture, during/after-hours handset tests, staff reply/resume and inbox/email receipt must be verified separately before declaring the connection live.
