# Data loss prevention — implementation and rollout

Date: 1 October 2026. Application report-export slice; full DLP programme remains open.

## Enforced application boundary

`GET /api/v1/reports/export` checks CSV and JSON through the same policy after existing current-role, organisation and intersected facility permissions. All nine known reports are confidential. Unknown report categories, non-scalar content, detected restricted fields/credential patterns/payment-card patterns, more than 5,000 rows or more than 5 MiB of UTF-8 JSON row data block release. These are conservative per-export limits, not aggregate exfiltration detection. The actual CSV/JSON response can include encoding overhead beyond the row-data limit.

The policy is versioned in code. No browser switch or environment variable disables it. Changes require code review and validation. Matching relies on deterministic field names and high-confidence patterns; it is not a guarantee that every secret, identity number or bank detail embedded in arbitrary text will be recognised. Legitimate numeric strings can match card rules and require review. Do not weaken a rule solely to bypass an unexplained block.

Before returning bytes, the system persists an organisation-scoped `AuditEvent` with actor, report key, optional selected facility, request reference, policy version, classification, row count and reason codes. No row content, raw matches, credentials or customer details are copied into DLP event metadata. If persistence fails, no report is released. `allowed` records a release decision, not proof that a user received the download. Permission failures occur before DLP evaluation and are not represented as successful policy decisions.

Responses use no-store, nosniff and no-referrer headers and include policy/classification/request references. These headers do not become enforceable file metadata after saving a download. Existing CSV formula escaping remains in force.

`/audit/data-protection` requires `audit.view`, scopes records to the current organisation and displays the most recent 100 DLP decisions. `/audit` displays safe rule details. This is a review view, not an automatic incident notification service or tamper-proof external log archive.

## Operator response

1. Use the request reference to locate a blocked event in System audit. Never paste blocked content or raw secrets into tickets.
2. For size limits, choose a smaller permitted facility/date scope. Repeated smaller exports are not automatically correlated in this slice.
3. For restricted content, review the source and report projection with the security owner. Remove inappropriate source content or correct the approved projection; do not authorise unrestricted release.
4. For an audit outage, restore database availability and investigate before retrying. The release remains blocked until the decision can be persisted.

## Remaining programme gates

Owner clarification (1 October 2026): Brett indicated that IT support may manage Microsoft 365 and staff computers, but the administrator is not confirmed. No external message or tenant/device change has been made.

- Application coverage: inventory all other egress paths, including signed-document and billing PDFs, MRI export, scheduled reports, attachments, staff search/API responses, email, SMS, WhatsApp and offline capture. Their existing access/privacy controls are not proof of a shared DLP boundary.
- Identity and financial policy: accountable approval of permitted recipients, classification, retention/deletion, sharing exceptions, employee training and incident ownership. Do not confuse security pattern detection with approved POPIA processing.
- File-level enforcement: persistent sensitivity labels, encryption and recipient restrictions need integration with the organisation's file/document platform. A classification HTTP header or file name alone is insufficient.
- Mail/network/cloud: verify tenant licensing and administrative access, configure the selected DLP service, test approved external recipients and block/quarantine paths. Application code cannot police forwarding from Outlook or copying between independent cloud repositories.
- Endpoint: managed-device enrolment and platform DLP policies for USB, printing, clipboard and personal uploads require IT configuration and physical-device UAT.
- Monitoring: repeated/bulk exfiltration correlation, alert routing, incident acknowledgement, retention and independent audit archiving remain unimplemented.
- Availability: backup encryption, immutable/off-site copies, retention, recovery objectives and witnessed restoration drills remain separate, unverified recovery work.
- Release: PR review, CI, deployment, read-only policy verification and controlled synthetic blocked/allowed export UAT remain required. Never insert real bank, card, identity or credential data to test detection.

## Validation evidence

Automated tests use synthetic report data and mock database/auth boundaries. They prove shared CSV/JSON enforcement, restricted-data blocks, nested-content rejection, row/byte limits, private response headers, organisation/actor audit attribution, no sensitive-content audit copies, denial before DLP and fail-closed audit outages. They do not prove live database persistence, cloud configuration or device enforcement.

## IT handover and acceptance checklist

1. Confirm the accountable security owner, Microsoft 365 tenant administrator, cloud repositories, managed-device inventory and available DLP licensing. Return only configuration evidence, never credentials.
2. Agree classifications and permitted sharing: personal records, identity copies, biometric information, financial exports and public material. Define approved recipients, exceptions, retention and incident response with the business/privacy owner.
3. Configure file sensitivity labels and recipient restrictions. Prove with synthetic material that restrictions survive a copy/move and an unauthorised user cannot open the protected file.
4. Configure email and cloud policies. Prove an approved internal recipient succeeds and an unauthorised external send/download is blocked or quarantined, with a traceable incident.
5. Enrol pilot computers and configure endpoint policy. Test USB copy, personal-cloud upload, printing and clipboard according to the approved policy; record actual device results and offline behaviour.
6. Assign incident monitoring and acknowledgement. Test that a meaningful alert reaches the responsible person, contains no unnecessary sensitive payload and has an escalation path.
7. Verify encrypted/off-site backup arrangements and perform a witnessed restoration against agreed recovery objectives.
8. Conduct staff UAT and training before broader enforcement. Link dated evidence and remaining exceptions to canonical PROJECT_CONTEXT.md. Do not mark the whole DLP programme complete from application tests alone.
