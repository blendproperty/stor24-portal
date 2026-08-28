# STOR24 operational UAT and training

This pack covers the operational release targeted for Thursday 3 September 2026. Financial integrations and Hikvision are explicitly out of scope. All evidence timestamps must be recorded in South African Standard Time (SAST, UTC+2).

## Sign-off rules

- Test production with named staff accounts and the facility access each role will use after launch.
- Use clearly identified test customers and units. Never cancel or alter a genuine customer record for UAT.
- Record tester, facility, SAST timestamp, result and evidence link for every scenario.
- A pass requires the expected database-backed result after a page refresh or a second signed-in session; a toast alone is not evidence.
- Log defects in Asana with severity, reproduction steps, facility, expected result and actual result.
- Stop launch for any cross-facility data exposure, duplicate active occupancy, inability to cancel a reservation, lost booking, invalid lease recipient or unhealthy database.

## UAT evidence sheet

Copy this table into the release task and add one row per scenario.

| ID | Tester | Role | Facility | Started SAST | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-01 |  |  |  |  | Not run |  |  |

## Production scenarios

### UAT-01 Public booking, reservation and cancellation

1. On the public website, select a real available unit type and submit a test booking using the approved UAT identity.
2. Complete the production CAPTCHA and email OTP manually.
3. Confirm the success page shows the correct facility, unit type and South African dates.
4. In CRM, find the same reservation and verify customer, facility, unit, status, expiry and audit history.
5. Cancel it through the supported staff action, enter the required reason and refresh.
6. Confirm the reservation is cancelled, the unit is available again and the audit trail identifies the actor and SAST time.
7. Remove only the approved UAT data with the documented reset action.

Owner input: Brett must complete CAPTCHA/OTP and confirm the record is visible before cancellation.

### UAT-02 Lead to move-in

1. Create a test lead and assign it to a staff member.
2. Progress it through the configured stages, proving that a note is mandatory for each progressed stage.
3. Convert or link the lead to a reservation and open the move-in handoff.
4. Confirm facility, customer and unit are carried across without retyping.
5. Complete the operational move-in steps, refresh and verify occupancy and unit status.

### UAT-03 Facility and ownership isolation

1. Sign in as a single-facility user and verify dashboard, calendar, tasks, customers, units, insurance and reports only show that facility.
2. Attempt direct navigation to a known record from another facility; access must be denied without revealing its data.
3. As an authorised multi-facility user, switch facilities and verify the selected scope is applied consistently.
4. Confirm task ownership cannot be used to view or mutate a record outside the actor's authorised facilities.

### UAT-04 WhatsApp

1. Use the approved UAT mobile number and approved production template.
2. Trigger the message from the intended workflow.
3. Confirm provider acceptance, handset delivery and correct rendered variables.
4. Reply from the handset and confirm the inbound message is associated with the correct customer or conversation.
5. Leave automated sending disabled unless Brett separately approves activation.

Owner input: approved WhatsApp UAT number and recipient consent.

### UAT-05 BlendSign success and failure handling

1. Complete one controlled test lease and verify the signing link, recipient and signed-document return path.
2. Use the approved failure case or controlled resend to prove the exception appears in Communications.
3. Confirm staff can retry, resend or dismiss only when authorised, with a reason and audit record.
4. Refresh and prove the resulting state is database-backed; confirm duplicate lease emails are not sent.

Owner input: approval immediately before a controlled retry or resend to the named test recipient.

### UAT-06 Insurance operations

1. Configure the approved provider, product, cover, premium, excess and policy wording outside source control.
2. Add the approved product to a test tenancy and verify facility, customer, unit, cover and effective date.
3. Amend and cancel the test policy; confirm each action is permission checked and audited.
4. Confirm insurance summaries and reports reflect the final state after refresh.

Owner input: approved commercial product and policy values. The application must not invent them.

### UAT-07 Reporting and monitoring

1. Run each operational report for one facility and for an authorised multi-facility scope.
2. Reconcile totals to the underlying dashboard or record list and export an approved report.
3. Verify all displayed and exported business dates are SAST.
4. Confirm `/api/health` reports application and database readiness.
5. Review the scheduled production monitor and prove a failed health check creates an actionable failed run.

### UAT-08 Migration rehearsal

Follow `docs/MIGRATION_REHEARSAL.md`. A pass requires the authorised legacy export, validator output, rehearsal import, facility-level reconciliation, exception log, rollback proof and named sign-off.

Owner input: authorised operational export. Financial history and Hikvision credentials remain excluded.

### UAT-09 Offline and recovery

1. Load the approved operational shell while online, then disconnect the device.
2. Confirm public quotes, availability, reservations, payments and legal/identity data do not masquerade as live cached data.
3. Exercise the approved encrypted offline reservation request on two devices and reconnect.
4. Prove idempotent synchronisation, conflict handling and operator visibility.
5. Review owner recovery and VPS rollback runbooks with the launch team.

## Role-based training

### Facility staff — 60 minutes

- Sign-in, facility scope and dashboard health.
- Lead capture, notes, reservation lookup, cancellation and customer communications.
- Calendar, task ownership, move-in handoff, insurance and reports.
- How to identify test data, log a defect and escalate a suspected cross-facility exposure.

### Managers — 45 minutes

- Multi-facility scope, operational reports and monitoring.
- Approval boundaries for WhatsApp, BlendSign resend, insurance configuration and migration cut-over.
- Launch stop conditions, rollback ownership and incident communications.

### Technical owner — 45 minutes

- Health endpoint, scheduled monitor, deployment evidence and database readiness.
- Backup, migration rehearsal, rollback and owner recovery.
- Secrets and provider configuration; never place credentials or customer exports in Asana or source control.

## Completion record

The UAT/training task may close only when all in-scope scenarios have a named result, critical defects are closed, required staff attended, launch owner signed off and all unresolved items are explicitly deferred with an owner and date.
