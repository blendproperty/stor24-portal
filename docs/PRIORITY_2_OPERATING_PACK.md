# Priority 2: privacy and security operating pack

Prepared 24 September 2026. Working procedure and evidence register, not legal approval or programme acceptance. The authoritative programme item is P14 in STOR24_DELIVERY_CHECKLIST.md. PRIV and CIA identifiers retain their original acceptance criteria.

## Privacy requests and complaints (PRIV-06/08/11)

Public intake: bookings@stor24.co.za, subject **Privacy request**. The published address is an intake route; delivery, ownership and response handling still need a rehearsal. Do not request passwords, bank credentials or an emailed identity copy.

1. Create a restricted case reference. Record received date, request type, contact, affected systems, assigned handler and next review date. Keep sensitive evidence outside a general spreadsheet.
2. Acknowledge receipt using the established mailbox. Verify identity proportionately through an existing verified contact or account process before disclosing or changing personal information. Record the method, not unnecessary document copies.
3. Determine whether the request concerns access, correction, deletion, objection, preferences or a complaint. The appointed privacy reviewer determines applicable legal deadlines, exceptions and any lawful preservation requirement. Do not invent a fixed deadline or automatically delete finance/legal evidence.
4. Inventory the affected records: customer and booking, agreements and finance, ID/photo submissions, provider copies, devices, exports and backups. Record each custodian and required action. Portal erasure alone does not close the case.
5. Apply authorised actions with an attributable audit record. Escalate a disputed access restriction for human review; do not represent a test payment as settlement or promise unverified gate restoration.
6. Respond with the outcome, any justified retained records and complaint route. Close only after confirming downstream actions or recording an explicit exception and follow-up owner.

Case register fields: reference; received; verified by/date/method; type; scope; handler; legal deadline confirmed by/date; next action; provider request/reference; retention exception and authority; outcome; response date; closed by/date; restricted evidence location. No real cases were created by this pack.

Rehearsal: use synthetic data to request a correction and deletion, include a retained invoice, a provider copy and a restored backup. Check acknowledgement, access control, traceability, exception reasoning and closure. **Not yet rehearsed.**

## Processing and retention decision register (PRIV-02/04/05/07)

| Data / processing | Observed purpose and boundary | Decision or evidence still needed |
|---|---|---|
| Name, email, mobile, booking | Booking and service contact; public notice and optional channel choices | Approved basis, unsuccessful/abandoned booking expiry, verified preference-change procedure |
| Quote and free-text enquiry | Respond to the enquiry; conditional automation/CRM copies | Confirm deployed recipients, minimise free text, approve lead expiry |
| ID image and verification result | Private identity review, encrypted database storage | Necessity of retained image, approved retention and no-show handling, deletion evidence |
| Facial photograph and template | Access enrolment subject to existing owner controls and provider readiness | Lawful basis, compulsory-access/alternative decision, minors/other users, provider/device deletion; owner switch is not legal approval |
| Agreement, invoice, receipt, ledger | Contract and financial evidence | Legal retention/preservation schedule approved by finance/privacy reviewer |
| Staff account, permissions and audits | Access control and accountability | Privileged access review, audit retention, MFA/recovery acceptance |
| Backups and exports | Recovery and authorised business use | Off-system/encrypted copies, expiry, custody and restored-data suppression/re-deletion |

Provider register to verify: hosting/database; Google reCAPTCHA; configured email provider; Twilio SMS/WhatsApp; Netcash; BlendSign; Hikvision/HikCentral; quote automation intermediary if deployed; MRI read checks. For each record actual data fields, purpose, enabled status, locations/subprocessors, agreement reference, security/deletion terms, transfer assessment, responsible contact and verification date. Do not assume every provider receives IDs/photos or is enabled.

## Security incidents and availability (CIA-A1/A2/A3)

1. Record detection time, affected service and observable symptoms. Preserve restricted evidence; keep secrets and customer records out of ordinary chat and tickets.
2. Assign an incident lead and communications owner. Assess confidentiality, integrity and availability separately. Use authorised containment, session revocation and provider controls; preserve audit evidence.
3. Determine scope from logs and verified records. A vulnerable dependency or source finding does not establish compromise. The privacy reviewer assesses notification obligations and timing from the facts.
4. Recover from a known version/backup in isolation first. Validate tenant/facility permissions, balances, signed documents and deletion suppression. Do not reconnect messaging, payments or physical access during a restore drill.
5. Record measured recovery time and data loss, approvals for reconnecting providers, monitoring results and lessons/actions. Close only after operational acceptance.

Required recovery evidence: business-approved RPO/RTO for booking, finance and access; backup schedule and monitored success; encrypted off-system storage and key recovery; isolated restore result; deletion reapplication; external alert received by a named person; rollback and provider-outage exercise. **Targets, custodians, alert delivery and restore performance remain unverified.**

## Acceptance handoff

Technical fixes and anonymous browser checks can proceed independently. Brett/privacy reviewer must still supply or approve accountability, legal/retention/processor decisions and recovery targets. Facility staff and providers must demonstrate real workflows, deletion and outage procedures. Keep P14 open until those gates and the linked PRIV/CIA checks have evidence.
