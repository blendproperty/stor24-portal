# Operational forms from Faeez’s attachments

Reviewed 30 October 2026 (SAST). All 16 non-signature attachments from the 28 October email were downloaded and read. XLSX cells across every worksheet, DOCX paragraphs/tables, both scanned mandate pages, the visitor PDF, the emergency poster and all 31 embedded maintenance images were inspected. Source material is private and remains outside Git. The connector materializes payloads; the hashes below describe those downloaded files, not an assertion that Graph's attachment-size metadata equals the materialized bytes.

## Attachment coverage

| Source | Mapping in the system | Boundary |
|---|---|---|
| Checklist 1 Opening.xlsx | Existing Checklists & padlocks: opening sections and counts | Reused; no duplicate engine or changes to existing runs |
| Checklist 2 Closing.xlsx | Existing closing checklist and three floor trolley counts | Reused |
| Cleaning Roster.xlsx | Existing cleaning areas and Sunday work | Reused |
| MANAGEMENT CHECKLIST.xlsx | Existing daily checks and Friday equipment tests | Reused; source service dates are examples, not imported |
| Padlock Count - Blank.xlsx | Existing current-inventory unit walkthrough and observed lock count | Original lettered unit labels are not current Midpoint inventory |
| The Procedure of the padlock Count.docx | Existing weekly rent-roll/collections comparison and separate GM review | No automated overlock eligibility or physical-access action |
| Attendence Form.xlsx | Client attendance definition: date, name, signature evidence, time in and out | Capture disabled pending privacy/signature/retention rules; not staff payroll |
| Visitor Entry Register.pdf | Visitor definition: date, name, time in, unit, contact, signature evidence | Capture disabled; original has no time-out column; no gate permission |
| Maintenance and Marketing Report.xlsx | New maintenance/marketing issue records, date discovered/reported/resolved, area, action, owner/contractor response, outcome, notes, related maintenance reference; up to three photographs per record. Separate certificate/service register and supplier quote-line drafts | Existing Maintenance and Calendar linked. Other-store defects, costs, dates, photos and contractors are not seeded as live work |
| Adjudication Form.docx | New supplier/service/cost review draft, station via selected store, form date, proposed payment/adjudication, start/completion, summary and approval reference | GM signature, procurement acceptance, spending and payment off; source is a completed third-party repair example |
| StoreSmart Quotation.docx | New sanitized wording draft links to existing Lead to lease quote workflow for real units/prices | No copying of example recipients, rates, other entity/links, hours, fixed height or insurance assertions; issue/send remains governed separately |
| Legal Letter 1.docx | Demand draft structure and review fields | No source recipients/dates/signatory imported; clauses, deadlines, wording and legal action unapproved |
| Legal Letter 2.docx | Final-demand draft structure | Submission/signing/sending disabled |
| Legal Letter 3.docx | Disposal-notice draft structure | No abandonment, credit consequence, disposal or recovery authority is inferred; disabled |
| Storesmart Debit order form.pdf | Disabled authority mapping: company/holder, primary/accounts contacts, identity/address, commencement, amount, bank/branch/account/type, authority/mandate/cancellation/assignment and dated signature. Links to existing billing/signing mandate workflow | No new banking/identity collection, replacement mandate, debit collection or provider activation |
| Fire Emergency Procedures.png | Private draft with site address, assembly point, verified contacts, escape-plan reference, safety instructions and reviewer reference | Poster address/assembly fields are blank. The source number/instructions are not certified. Staff publication and safety acceptance remain off |

## Workflow and access

Operations centre → Operational forms. Reuses Task, current facility permissions, task queues, Calendar links and AuditEvent. No new dependency. Ordinary view staff may prepare their own maintenance reports; other draft types require current operations.manage. Managers see records in their permitted stores; other staff see their own records. No form payload/photos are exposed by the ordinary Operations dashboard or Calendar. The generic Complete action cannot close or reopen a structured form.

Maintenance and certificate records: draft → submitted to a named independent current-store manager → returned for correction or reviewed/read-only. All required fields and date order are server validated. Review records the report review; it does not certify equipment, complete a repair, place an order or approve expenditure. Use the existing maintenance queue for repairs and Calendar for agreed follow-ups/service dates. No automatic follow-up dates or recipients are inferred.

Supplier/adjudication, quotation wording, all legal and emergency forms: internal drafts only. Submit/review actions remain server-blocked, with no publication/send/payment/provider endpoint. Client attendance, visitor and debit authority capture are server-disabled, not merely hidden buttons. Agreement on the relevant rules and a separate reviewed activation change are required. There is no UI override.

Each save uses the current record version under a row lock. Replayed creation keys return the original draft; changed replays conflict. Closed records cannot be rewritten. Current roles and store assignments are re-read. Audit failure rolls back mutations. Audit contains field revisions and photo hashes, not duplicate base64 images. Photos are private JPEGs normalized server-side to strip metadata, bounded to three/300 KB each/10 million input pixels. Draft photo removal replaces draft evidence; closed evidence is immutable. Original images and original third-party records are not published. Unknown network outcomes block further mutation until the saved state is read.

## Remaining decisions and verification

Approve client/visitor privacy notice, visibility, retention and signature capture before collecting those records. Agree supplier/GM spending thresholds and actual signature authority; commercial quotation wording/entity/hours/dimensions/insurance; legal clauses/timing/fees/restoration/disposal; debit mandate/provider requirements; site-specific emergency contacts/assembly/escape instructions. Those holds are retained in the UI and backend. Staff/device UAT, production deployment and live verification remain separate from isolated tests. Existing checklist scheduling and separate approvals are unchanged.

## Materialized source fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| Attendence Form.xlsx | 11552 | 30a50ed085809a5f7dc0997c1a66c6579f30767cbcc794bd07148f3098e223fa |
| Checklist 1 Opening.xlsx | 12665 | 1bb1b5dbacc09602a566c3ce52685d8fad1d5c8f2f03e0d2ea2f4e7f767e0a75 |
| Checklist 2 Closing.xlsx | 11251 | f1281c86bbcf53a6ead9fc315d5587c672b58562b7a61bb2229e24dec88c5b4a |
| Cleaning Roster.xlsx | 11470 | 70e967643c412e031a13dede6940d0ae28b730be5bdc3ad476b0e0e4c8d084ae |
| Fire Emergency Procedures.png | 1332639 | ec363d661a9ef40de3c93184b203f85b28d64fd3c0752616ab58745420b96a45 |
| Adjudication Form.docx | 45288 | d9f306c4870e43eda2733060ff35dc98a3d218bcf7a3be77ef703ad749e3f3f6 |
| MANAGEMENT CHECKLIST.xlsx | 11712 | 16b02d7ce7e6352547553870ca9f02f668c45e634d86ff334c763d85cda21474 |
| Padlock Count - Blank.xlsx | 18207 | 9ed4862dcf5947158ec2cb7869e1648f523d104a31d9373c10aa938f6f5a8940 |
| StoreSmart Quotation.docx | 1119936 | e405240664972e3ab6662de3e321cbebdf1dfadf357cf68bcb9e0061353045ac |
| The Procedure of the padlock Count.docx | 14003 | 66846f980278276d1fb24c8afefcd83573e096c50541a6e256795e9b4cba746a |
| Maintenance and Marketing Report.xlsx | 5975597 | db464147acfe325a43c8ab094fd7e90c740d2660ca78aa43a14274c893ee3e5a |
| Legal Letter 1.docx | 1093180 | 1dd67f8f842482295ec28da68b094976962661bc22aa8e995db60e2d5916c717 |
| Legal Letter 2.docx | 1092648 | 65f1a61c6d385e00c8151f0db21cd104adb0d133a34a6ffa99aedeaf9d6e7e00 |
| Legal Letter 3.docx | 1092388 | 95c5a7c1ac2b058e92f2d5569fd8b967e12f06f77ac6b05c6e23ff0c3eaf4285 |
| Visitor Entry Register.pdf | 16553 | 53672d72028f1f3aa4d9b06bedb9f33af100d81fbfd266017cb410208c965adb |
| Storesmart Debit order form.pdf | 1774237 | eeb5803079947c8b27f24d0e3dfcad30a103998ce68d2900442315ce5ab818f9 |
