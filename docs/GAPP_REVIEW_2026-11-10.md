# GAPP follow-up — 10 November 2026

Scope: source and existing release records on CRM main `428cfdc5b56a4b3926aea9979a47c8dcf44f863b`. This is a targeted follow-up, not a fresh full audit, legal assessment, live configuration inspection or GAPP certification. The original [PRIV-01–11 register](PRIVACY_GAPP_GAP_REVIEW_2026-09-23.md) retains its historical observations and acceptance criteria; the [Priority 2 release](PRIORITY_2_RELEASE_2026-09-24.md) supersedes its original notice and default-choice observations.

| Item | Current evidence and remaining action |
| --- | --- |
| PRIV-01 | Interim privacy and PAIA information and form links were deployed and checked in the September release. CRM notice has since evolved, including analytics disclosures. Legal approval, formal PAIA manual, accurate current cross-site notices and contact handling rehearsal remain open. |
| PRIV-02 | Current source still identifies the facial notice as interim and awaiting review; its owner switch checks encryption and maintenance, not legal approval. Confirm the actual legal basis, alternative and provider arrangements before wider collection. Current production switch state was not checked in this review. |
| PRIV-03 | September release recorded explicit booking choices and notice evidence; current quote service records no optional channel selection by default. The current notice distinguishes required email/WhatsApp from optional SMS/phone. Verify the actual current public journey, preference changes/withdrawals and downstream sending before acceptance. |
| PRIV-04 | Identity source requires a configured approval reference and retention policy; photo lifecycle controls exist. An approved data-specific schedule, abandoned/no-show cases, legal holds and representative deletion evidence remain needed. Do not invent retention periods or delete records based on this review. |
| PRIV-05 | The MEL ownership matrix says access revocation does not delete provider biometric records and a permanent deletion workflow remains missing. Confirm provider/device deletion, backup expiry and restore re-deletion through an end-to-end exercise. |
| PRIV-06 | The operating pack describes a restricted manual privacy request process; the contact route and a full synthetic rehearsal, including retained records and provider/backup follow-through, remain unverified. |
| PRIV-07 | The operating pack identifies candidate processors, but deployed data flows, locations, contracts, transfers and deletion obligations need an owner-verified register. Inclusion in a notice does not prove a provider is configured or an agreement exists. |
| PRIV-08 | Appointment/registration evidence, named operational ownership, training and exercised incident procedures remain to be verified. Lack of repository evidence does not establish that these do not exist. |
| PRIV-09 | The current CRM notice describes consent-based Google, Meta and Clarity measurement and choices. The old pre-tracking observation is historical. Review the actual public site's current scripts, consent, storage and network traffic in fresh browser sessions and verify withdrawal; this review did not do so. |
| PRIV-10 | Finance and access data accuracy, human review, provider suspension/restoration and actual physical tests remain acceptance gates. Do not infer a real restriction or restoration from simulation. |
| PRIV-11 | The operating pack supplies a proposed process, not evidence of assigned monitoring, complaint reviews or completed exercises. Assign ownership and record periodic review and exceptions. |

## Technical hardening in this follow-up

The password-reset route now logs a fixed delivery-failure message instead of an arbitrary provider error, which could contain a recipient or reset link. The generic response and failure signal are retained. This reduces a potential logging exposure; it does not establish a historical leak or complete a logging audit. A synthetic route test injects sensitive provider error text and checks the response and log.

No acceptance item is closed by this source review or the logging change. Maintain P14 and legal, provider, data, training, staff/customer/device, recovery and business approval gates. No live data, configuration, provider or customer action was performed.
