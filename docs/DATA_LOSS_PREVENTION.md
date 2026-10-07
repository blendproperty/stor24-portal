# Data loss prevention — application and server controls

Updated: 7 October 2026. Policy 2026-10-07.1. Microsoft 365 DLP remains open by Brett's explicit instruction after the signed-in account was denied administrator access.

## Mandatory application boundaries

Reports (CSV, JSON, XLSX and PDF) preserve current-role, organisation and intersected facility permissions. Known reports are confidential. Unknown categories, restricted field names, nested data, detected credentials/payment-card patterns, more than 5,000 rows or more than 5 MiB UTF-8 row data block release. Encoding overhead can increase the final response size.

Private documents, signed agreements, mandates, statements, invoices, identity/photo previews and collection/settlement exports pass the shared transfer guard after existing exact-resource ownership/access checks. Transfers above 20 MiB block. CSV/HTML content is inspected; signed PDFs/images preserve their original bytes and use access, size, rate and audit controls rather than binary OCR/content discovery. Public legal terms and synthetic training images are explicit non-sensitive exemptions. This is not a general file-system scanner or arbitrary API content scanner.

Application email requires a scoped DLP context and an approved recipient. Application SMS/WhatsApp enforce the same transfer boundary before provider calls. Text is inspected for high-confidence credentials/card patterns and configured secrets. A recipient must match the server-authorised recipient. This prevents a mismatched destination; it does not independently certify a recipient selected by an authorised business workflow. Providers never receive DLP metadata. WhatsApp stores a hash of template variables for replay comparison instead of new raw variables; historical metadata is unchanged.

A durable PostgreSQL counter limits transfers to 60 per hour per organisation/channel/actor, or destination hash/resource for anonymous/customer flows. Reports and staff downloads share the DOWNLOAD counter. This bounds repeated transfers but is not comprehensive cross-channel anomaly detection.

Every allowed or blocked evaluation persists a safe AuditEvent before release. Database/limiter/audit outage blocks the transfer. Events record policy, classification, resource, request, actor/scope, counts, reason codes and destination hashes where relevant. They exclude raw matches/message content/recipients. Permission failures occur before the guard. Allowed means permission to release, not delivered/read confirmation. All private API responses have no-store/nosniff/no-referrer headers. Classification headers do not provide persistent file labels after download.

The organisation/facility-scoped Data protection page shows the latest 100 DLP decisions and backup evidence. System audit shows safe reasons. Use request references to investigate; never paste sensitive matches into tickets. Audit records share the application database and are not an independent immutable archive. Current rules are mandatory versioned code; no production bypass switch exists.


## Personal-data export authority

A Super Admin is the current organisation-wide Organisation owner. Downloads containing customer/tenant names, account identifiers, email/mobile/phone fields, addresses or detected contact values require that owner or an exact `data.personal_export` grant. General `*`, `data.*` and report permissions cannot imply this grant. The grant is intersected with existing report/export organisation and facility scope; it cannot replace either permission. Existing secrets, identity/bank fields, cards, size and rate rules still block exports even for owners.

Only owners can grant/revoke individual permissions or change security roles. Use Users > Edit permissions > Export personal data (Super Admin authorisation), alongside the required report/export permissions. Each change is transactional, audited and increments the target's session version. Personal-export administrators cannot delegate this grant or promote themselves. Existing roles receive no automatic opt-in.

Personal bulk collection and settlement downloads require the same exact grant against current active database assignments. Authorised report viewing and individual customer-document workflows retain their exact-resource access controls; this policy does not prevent screenshots/copying information a user can legitimately view. Report download audits additionally record format, period and personal column names, never their values. The Data Protection register distinguishes preview and download, actor, format/count and block reasons. An allowed audit means authorised release, not proof that the user saved or opened the file.

`scripts/verify-personal-export-live.ts` is an explicitly opted-in operator proof using a new disposable synthetic organisation only. It exercises all formats, wildcard denial, owner delegation/revocation, session invalidation, non-delegation and saved audit decisions through real HTTP handlers, then removes its synthetic records. It must not be run against existing staff or customers.

## Encrypted server backups and restore proof

scripts/dlp-backup.sh streams PostgreSQL custom dumps directly through AES256 GPG encryption, verifies decryption/archive structure and writes checksum plus sanitized status. No new plaintext database dump is written. Archives are root-only under /opt/backups/stor24-dlp; the separate passphrase is root-only under /root/.config/stor24-dlp. The application mounts only sanitized status read-only. Existing historical deployment backups are preserved until approved retention handling.

The deployment workflow runs an encrypted predeployment backup before migration and installs a daily systemd backup timer (01:00 UTC / 03:00 South Africa, up to five minutes randomized delay). Monitor production checks encrypted backup freshness (26-hour limit); failed GitHub runs expose an operational failure, subject to repository notification settings. The Data protection page marks stale/unavailable status unverified.

scripts/dlp-restore-proof.sh verifies a supplied archive/checksum and restores it into a disposable PostgreSQL container with no network, ports or production data mounts. It checks schema and readability of seven core tables and removes that container. This proves restoration/readability of that archive, not full business recovery/UAT or a snapshot-by-snapshot row comparison. The original production database is not modified by this restore exercise. scripts/verify-dlp-live.ts performs a separately opted-in synthetic application proof, using a newly created disposable organisation and a 90-second test session; it sends no customer message and cleans up only its own synthetic records.

## Remaining gates

- Microsoft tenant email, SharePoint/OneDrive/cloud and endpoint DLP: administrator access, appropriate licensing, policy setup and real managed-device validation remain open. User instructed application/server work to proceed and Microsoft DLP to remain open.
- Off-site encrypted copies, independent key escrow, immutable retention, storage-capacity policy and disaster recovery objectives remain open. Local encryption cannot recover from loss of the server and its key. No off-site destination was configured.
- Approved sensitivity labels/sharing exceptions, incident owner/escalation, independent audit retention, staff training and operational UAT remain open.
- Existing provider, legal/privacy, finance, data, training and business approval gates remain open. MRI/provider activation, payments, access and consent switches are not enabled by this change.

Acceptance evidence is maintained in canonical PROJECT_CONTEXT.md, separating local validation, remote CI, merge, configuration/deployment and live proof. Do not mark the complete organisational DLP programme closed from this application/server implementation.
