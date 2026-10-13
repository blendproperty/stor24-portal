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

Native transport: use WhatChimp FORM-DATA key/value rows for customer answers. The intake supports multipart and urlencoded text fields with the same 8 KiB cap, scoped authentication and strict DTO. Duplicate fields, file uploads and invalid form bodies are rejected. Keep JSON only for static probes; do not interpolate arbitrary customer text into raw JSON.

## Provider configuration evidence - 13 October 2026

Dedicated API IDs10107-10113/10115-10117 are bound to bot475943; probe10106 is no-write. Active guided flow2166212 and staff route2166213 pass native Save and official-export readback. Each checkpoint reset connects through a condition bridge before HTTP because direct RNG-to-HTTP is incompatible in WhatChimp. Failed guards offer Retry/Menu and do not claim submission. Menu and welcome staff shortcuts use the gateway; default human action calls route with a generic inbox receipt. Native human pauses automation until Chat with robot or staff Resume Bot. A user test on13October initially reached a still-paused prior conversation; it was resumed and fresh UAT is pending. No full transcript synchronization is claimed. Production/provider connectivity is proved by no-write PROBE; structured lead/task and after-hours handset acceptance remain open.

## 13 October 2026: paid-plan recovery and native move-in date

Real user enquiry submitted after Pro Monthly activation: seven answers, same WhatsApp-source NEW lead, one follow-up task. The old trial200/200/402 blocker is historical. Native CRM Storage use selector remains separate from the captured use answer in sales notes.

Enquiry2166460 replaces2166212 aliases/menu destination; previous flow remains rollback without keywords. Move-in is a multiple choice: Not sure routes through normal10110 save guard; Choose a date opens published form42755 (Meta4613262398945605), screenSTORMOVEINDATE, required preferred_move_in_date bound to77751. Submit uses keyword-free reply2166437 (native reply3527362). Continuation resets checkpoint, bridges to10110, requiresSAVE_START then asks duration/size/viewing/name and retains guarded submission/hours routing. Main90nodes and continuation60nodes pass native Save and official export reachability/edge checks. Native preview calendar14October2026 enables Use this date; no fake production test record created.

Question-final requires RNG before a Condition; direct question-final to Condition is rejected. Rejected private2166459 and component2166458 retain no keywords and are unreachable. Handset calendar/Not sure, real after-hours and actual staff reply/resume/email coverage remain UAT gates. Original OTP/provider sender stays unchanged.
