# STOR24 whole-system map and integration inventory

Evidence snapshot: **17 November 2026, SAST**. This is an architecture and readiness snapshot, not a deployment manifest, approved privacy register or launch sign-off. "Live proof" applies to the named observation only. "Partial" means that some features or checks are evidenced and others remain open. "Test only" identifies controlled test/preview proof; "gated" identifies an unresolved prerequisite. Product names here refer to STOR24's integration scope, not every capability of the vendor.

`Public website / Counter / My STOR24 / WhatChimp → CRM → leases, occupancy, payments, reporting and operational decisions`

CMS supplies website content. BlendSign supplies agreement and signing evidence. Netcash supplies processor results; bank records independently evidence cash settlement. The CRM ledger remains the operational accounting record; approved consolidated entries are the intended MRI boundary. Physical access remains a separate approved decision and reader verification.

## 01 Channels & customer journeys

| Scope | Evidence status | What exists and what remains |
| --- | --- | --- |
| Public website | LIVE | Unit finder, storage calculator, booking and micro-warehousing enquiries. |
| My STOR24 | LIVE | Sign-in, quotes, agreements, statements and receipts; permissions apply. |
| STOR24 Counter & offline PWA | PARTIAL | Assisted visits and QR handoff; new photo handoff merged, live device proof open. Offline two-device UAT open. |
| Payload CMS | LIVE | Editorial, media and SEO → website. CRM owns units, prices and operational state. |

## 02 Messaging & lead capture

| Scope | Evidence status | What exists and what remains |
| --- | --- | --- |
| WhatChimp · WhatsApp | PARTIAL | Assistant → CRM lead intake proven on a controlled enquiry before cutover. Recheck workflows after migration. |
| WhatChimp · Facebook & Instagram | TEST | Both draft flows reached CRM in previews. Bots inactive; real channel-to-staff checks open. |
| Twilio · SMS & WhatsApp | PARTIAL | OTP, templates, delivery status and inbound replies. Lifecycle/arrears automation separately gated. |
| Email & n8n | PARTIAL | Transactional notices and monitoring email. Legacy quote → n8n route exists; current live use unverified. |

## 03 Payments & accounting

| Scope | Evidence status | What exists and what remains |
| --- | --- | --- |
| Netcash | TEST | Pay Now card / Instant EFT tested. eMandates, EFT batches, DebiCheck, card subscriptions, payment requests and refunds have separate gates. |
| Statements & bank reconciliation | PARTIAL | Netcash daily records + bank evidence → CRM ledger review. Real settlement and finance sign-off open. |
| MRI Property Central | HOLD | Connection/read and journal preparation exist. Finance mapping, provider import and production posting open. |
| Live money & finance policy | HOLD | Keep production payment/recognition hold; approve collections, corrections, fees and move-in policy. |

## 04 Leases, identity & physical access

| Scope | Evidence status | What exists and what remains |
| --- | --- | --- |
| BlendSign | LIVE | CRM → signing envelope → verified completion and retained agreement. Legal/template UAT remains. |
| Identity, consent & photo review | TEST | Original-ID checks and private review. Unit 58 photo-only trial showed a saved record; erasure/device checks open. |
| Hikvision / HikCentral | HOLD | Provider adapter and admin setup exist. Trusted connection, door mapping, enrolment, entry and revoke proof open. |
| MEL / Active Motion | HOLD | Access ownership, identity links, POPIA and manual fallback require agreement. No MEL grant authority. |

## 05 Commercial & facility operations

| Scope | Evidence status | What exists and what remains |
| --- | --- | --- |
| Leads → reservations → tenancies | LIVE | Follow-up tasks, unit holds, availability, transfers, move-in/out and approval controls. |
| Finance & merchandise desks | PARTIAL | Accounts, arrears, ledger, receipts, POS/stock, packing sales, fulfilment and scheduled expiry; UAT gates remain. |
| Site execution & reporting | PARTIAL | Facility maps, jobs, checks/forms, staff permissions/MFA, export and reports; device/training acceptance open. |
| Insurance, legacy migration & telephony | HOLD | Insurance records/preflight exist; approved insurer, production import and separate voice readiness unverified. |

## 06 Acquisition, platform & resilience

| Scope | Evidence status | What exists and what remains |
| --- | --- | --- |
| Google & Microsoft | PARTIAL | reCAPTCHA, GA4, Ads, Search Console and Clarity. Consent, privacy and paid-click reconciliation remain tracked. |
| Meta & Google Tag Manager | PARTIAL | Facebook/Instagram ads and Meta lead receipts; GTM preview unpublished. Keep deduplication and consent checks. |
| Hostinger VPS & Cloudflare | LIVE | Website, CRM and CMS dependency health passed. Docker, PostgreSQL/Prisma and GitHub Actions underpin releases. |
| Data protection & recovery | PARTIAL | Role scopes, audit, encryption, monitoring and backups; complete off-server recovery, data handling and UAT remain open. |

## Integration detail and release boundaries

- **WhatChimp:** Locate the WhatsApp assistant and the scoped Facebook/Instagram flows separately. The earlier WhatsApp CRM test predates the 16 November workspace cutover. Social previews called the real CRM with labelled test inputs; follow-up tasks appeared and staff mail receipt was user-reported. Restricted real Messenger test returned overlapping replies and was stopped. Social drafts have no active trigger; live Messenger/Instagram submission, channel overlap, routing, data completeness and staff acceptance are open. Keep WhatsApp assistant intake separate from Twilio outbound messaging and fail closed on unapproved triggers.
- **Twilio, email and voice:** Twilio SMS/WhatsApp OTP, approved templates, replies, opt-out and status callbacks are distinct from unattended lifecycle/arrears sends. Email supports SMTP, Resend, SendGrid and Twilio email adapters; support is not proof that each is active. Health/monitor sends and notices have prior bounded evidence, with channel and staff delivery gates retained. Phone/voice provisioning (including the earlier Vox workstream) was not verified as an app integration. Older n8n quote route and the proposed access-automation boundary are separate; no pipeline production acceptance inferred.
- **Netcash:** Pay Now test card and Instant EFT outcomes are documented. Product-specific lanes include hosted eMandate/OTP/PDF, Standard EFT debit runs and load reports, DebiCheck consent/authentication and collections, card subscriptions, Payment Request, AVS checks, refunds/reversals and daily statement matching. These lanes are not equally ready. A signed mandate or accepted batch is not collected cash. Preserve developer/production segregation, provider onboarding/keys, authorized payer/date and cutoff rules, unsuccessful and duplicate outcomes, receipts, fees/retention, payout/bank proof, finance policy and business approval. Account for direct bank/card evidence before marking a balance paid; separate terminals and POS do not by themselves prove an integrated terminal settlement.
- **MRI Property Central and bank:** API authentication, bounded live reads and isolated sandbox journal preparation have evidence. Keep the dedicated property/entity, approved mappings, balanced batch, duplicate/reversal and import/acceptance readback requirements. No production journal posting claimed. Match statement collections, returns and fees to posted evidence and prove payouts against bank records (Nedbank remains a separate bank relationship; no direct bank API asserted).
- **Hikvision / HikCentral, MEL and Active Motion:** CRM role/connection administration, provider/identity-link source, review and guarded access decisions exist. Unit 58 photo-only proof covers a saved record, not biometric enrollment, deletion or physical entry. The customer-only Counter photo handoff is on merged sources; this audit did not check its deployed image or real device. Access group/door mapping, trusted provider contract/TLS, authority, minimal identity sharing, POPIA and lawful policy, retention/backup, approved rehearsals and physical grant/revoke/outage tests remain separate. Do not treat a photo, signed lease or payment as reader activation.
- **BlendSign:** CRM requests signing, validates completion and retains artifacts; BlendSign owns the envelope, signatures/certificate, delivery and sealing. Public/staff lease routes and signed-artifact proof do not approve the legal terms or prove every template, signatory, transfer and completed-copy workflow.
- **Marketing and website processing:** Google reCAPTCHA protects relevant public flows. GA4, Google Ads, Google Search Console, Microsoft Clarity, Meta Pixel/Conversions API and Meta ad reporting are documented; consent, deduplication, accepted provider attribution, privacy requests and retention stay in scope. GTM Preview is distinct from publishing. Public content reads through the website from Payload; CMS has its own data and editorial permissions. Public health is not a live marketing test.
- **Operations and resilience:** Inventory, pricing/discounts, deposits, leasing and operational forms, staff accounts/MFA, reporting/CSV, lead follow-up, private documents and outboxes run through CRM boundaries. Stock/merchandise expiry, worker/report scheduling, notifications, PostgreSQL backups and restore checks have distinct evidence. Do not infer complete migration, isolated full-host recovery, off-server backup acceptance, insurance underwriting/activation, legal/privacy approval, physical UAT, training or general readiness. Legacy SiteLink/source data is a migration/preflight stream; no live legacy synchronization is asserted. OneDrive backup evidence, if configured, is neither full recovery coverage nor host-loss proof.

## Evidence reviewed

| Canonical source | Snapshot |
| --- | --- |
| [CRM and canonical context](https://github.com/blendproperty/stor24-portal/blob/b23999e6/PROJECT_CONTEXT.md) | `main` at `b23999e6`. See 16 November WhatChimp cutover/social handoff and 17 November Unit 58 evidence. PR #849 adds callback concurrency guards; merged source and isolated tests do not prove live provider retry. |
| [Website and canonical context](https://github.com/blendproperty/stor24/blob/4da2c4b/PROJECT_CONTEXT.md) | `master` at `4da2c4b`. See public booking, WhatChimp, consent, ads and GTM evidence. |
| [CMS and canonical context](https://github.com/blendproperty/stor24-cms/blob/0273cd2/PROJECT_CONTEXT.md) | `main` at `0273cd2`. See editorial release, internal access and data/recovery history. |
| [BlendSign and canonical context](https://github.com/blendproperty/blendsign/blob/d525abf/PROJECT_CONTEXT.md) | `main` at `d525abf`. See assisted STOR24 signing and infrastructure checks. |

CRM supporting evidence: [WhatChimp WhatsApp](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/WHATCHIMP_CRM_INTAKE.md), [WhatChimp social](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/WHATCHIMP_SOCIAL_INTAKE.md), [Netcash products](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/NETCASH_FULL_PAYMENT_SCOPE_2026-10-14.md), [settlement](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/SETTLEMENT_RECONCILIATION.md), [MRI](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/MRI_INTEGRATION.md), [photo/access](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/FACIAL_ACCESS_RELEASE.md), [MEL ownership](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md), [privacy processor working register](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/PRIVACY_PROCESSOR_DATA_FLOW_2026-11-13.md) and [migration rehearsal](https://github.com/blendproperty/stor24-portal/blob/b23999e6/docs/MIGRATION_REHEARSAL.md). These documents are historical inputs where the dated release record is newer.

Read-only checks at **14:32 SAST**: [public website health](https://stor24.co.za/api/health) returned 200 and reported CMS and CRM dependency checks successful; [CRM health](https://portal.stor24.co.za/api/health) returned 200 and reported app, database and merchandise expiry healthy. No provider transaction, real enquiry, customer message, hardware access or configuration change was initiated. Infrastructure health does not establish feature or provider end-to-end verification.
