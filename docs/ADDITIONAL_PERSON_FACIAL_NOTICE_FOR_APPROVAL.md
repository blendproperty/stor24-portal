# STOR24 additional-person facial access notice — for Liezl's approval

**Status:** proposed wording, 13 November 2026. Not approved, published, or configured. Do not enable `ADDITIONAL_ACCESS_POLICIES_JSON` or collect a real person's photo from this draft.

This is a separate notice for each nominated person. It does not rely on the booking holder's acceptance of the storage terms or Midpoint's general website privacy notice. Clause 21 of the approved STOR24 customer terms expressly requires separate informed facial-recognition consent, an approved alternative-access arrangement, and provider retention/deletion disclosures before enrolment.

## Proposed tablet notice

> **Your photo for STOR24 access at Midpoint**
>
> You have been nominated to access a STOR24 booking at the Midpoint precinct. STOR24 (Blend Property 20 (Pty) Ltd) asks you to take or choose a clear photograph of your face. Authorised STOR24 staff will check your identity and review the photograph. If your access is approved and the precinct system is ready, your photo and identifying details may be sent to the Midpoint Hikvision/HikCentral access system to create a facial-recognition template and assign only the approved access points. Taking a photo, submitting it, or passing STOR24's review does not activate entry.
>
> This is your own choice. The booking holder cannot consent for you. If you do not wish to use facial recognition, do not submit a photo. Contact the STOR24 facility manager before your visit to discuss access. **The specific non-biometric access process and who can authorise it must be approved and inserted here before this notice is used.**
>
> The portal stores your submitted photograph encrypted and limits it to authorised reviewers. **Proposed portal limit for review: 30 days from submission**, with earlier removal if you withdraw, your nomination is removed, or the booking ends. A renewed photo and consent would be needed after expiry. **HikCentral and reader copies, access logs, consent/audit records and backups may follow different periods. Their actual retention, deletion process and responsible party must be confirmed and inserted here before enrolment.**
>
> You can withdraw your facial-photo consent or request access, correction or deletion by contacting STOR24 at bookings@stor24.co.za. Withdrawal stops future photo use and starts the applicable removal process; staff must confirm removal from HikCentral and readers separately. Some records may need to be kept for a stated legal reason. Withdrawal may affect your ability to enter until an approved alternative is arranged.
>
> STOR24's [privacy notice](https://stor24.co.za/privacy) explains general processing and your privacy requests. **The precinct operator's role, any processor agreement, hosting location, cross-border processing and provider/device safeguards must be confirmed before this notice is used.**

## Proposed separate checkbox

> I am the person named above. I have read this separate facial-access notice, including the purpose, review, retention, withdrawal and access arrangements. I agree to STOR24 capturing my facial photograph for staff review and, only after separate access approval, submitting it to the confirmed precinct facial-access system. I understand that submitting a photo does not activate entry.

The checkbox must start unticked and be completed by that person on the customer tablet after staff verifies the person's identity. The staff attestation and the person's consent are separate records. The displayed notice version, consent text, person, time and policy hash must be retained with the submission. A material wording change requires fresh consent.

## Decisions required before activation

| Decision | Proposed position / evidence still needed |
| --- | --- |
| Lawful basis and wording | Liezl to approve or amend this notice and checkbox for each additional person, including compulsory-versus-optional access implications. Record document/version and dated approval reference. |
| Alternative entry | Midpoint/STOR24 to specify a real non-biometric route, operator, hours and identity checks; Liezl to approve the wording. The current generic contact instruction is not an operational alternative. |
| Portal photo | Proposed maximum 30 days from submission for review, earlier on withdrawal/rejection/nomination removal/booking end; confirm whether approval or active access requires a different lifecycle. `retentionHours=720` is only a candidate setting. |
| HikCentral/readers | Installer/precinct operator to confirm where the image/template is stored, actual retention, access and deletion API/process, distribution and acknowledgement, and how deletion is verified at each reader. |
| Other records | Liezl to decide consent, audit, access-log and backup retention, and restoration/re-deletion handling. |
| Parties and transfers | Confirm STOR24, Midpoint operator, Hikvision and any host/processor roles, agreements, location and cross-border disclosures. |
| Minors | Exclude under-18 nominees until a separate approved process exists. |

**Release boundary:** this document supplies a concrete draft for review. It is not an `approvalReference`, an enabled policy entry, an instruction to enrol anyone, or evidence of physical access. After approval, configure the exact approved version and retention, test the tablet with a consenting participant, and separately verify HikCentral grant and removal at the installed reader.
