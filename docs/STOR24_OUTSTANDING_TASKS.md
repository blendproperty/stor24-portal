# STOR 24 Outstanding Tasks

> Status date: 2 September 2026  
> Canonical programme repository: `blendproperty/stor24-portal`  
> Production branches: CRM `main`; public site `master`; CMS `main`; BlendSign `main`

This is the consolidated outstanding-work register for the STOR 24 programme. It must be read with the current `PROJECT_CONTEXT.md` in each affected repository. A task is not complete merely because code exists or a deployment is healthy: implementation, tests, promotion, deployment/configuration, live verification, business UAT and approval remain separate evidence gates.

## Executive priority list

| Priority | Workstream | Current status | Primary blocker / next action |
|---|---|---|---|
| 1 | Netcash payments and debit orders | **Blocked — pending API information** | Obtain complete provider contract, service keys, sandbox access, endpoint/payload definitions and callback-authentication specification. |
| 2 | Hikvision / HikCentral access control | **Blocked — pending API information** | Obtain approved OpenAPI details and mappings; resolve the untrusted TLS chain and POPIA/responsibility boundary. |
| 3 | Public booking end-to-end UAT | **Ready with approval** | Brett must approve a controlled CAPTCHA/OTP test and provide a consenting test recipient. |
| 4 | Unit-transfer signing document | **Blocked — Legal approval** | Legal must approve the document type, clauses, payment-mandate treatment and signature rules. |
| 5 | MRI/MDA finance integration | **Blocked — business/vendor decision** | Confirm the system owner, integration method, mappings, reconciliation and exception ownership. |
| 6 | WhatsApp lifecycle automation | **Implemented but deliberately disabled** | Complete controlled delivery/callback/opt-out/failure UAT before any enablement decision. |
| 7 | Operational readiness and cut-over | **Open** | Complete migration rehearsal, staff training, monitoring/recovery, support ownership and business sign-off. |
| 8 | Security and residual product QA | **Open** | CMS MFA, dependency remediation, two-device offline UAT and public 3D residual checks remain. |

## 1. Netcash payments and debit orders

**Status: BLOCKED — pending API information and service credentials.**

Existing code is a provider scaffold and the public Pay Now journey is a UAT simulator. It must not be described or enabled as real payment processing.

- [ ] Obtain the signed/approved Netcash product and onboarding contract for the exact services STOR 24 will use.
- [ ] Obtain sandbox credentials, account/service keys, vendor key if required, base URLs and activation status.
- [ ] Obtain authoritative endpoint paths, request/response schemas and worked examples for Pay Now, AVS, eMandate/DebiCheck, standard debit orders and statement retrieval.
- [ ] Confirm return, cancellation, notification and webhook URLs.
- [ ] Obtain the official callback authentication/signature/hash specification, timestamp/replay rules and retry behaviour.
- [ ] Confirm mandate creation, status, cancellation and collection lifecycle rules.
- [ ] Confirm debit-order submission cut-offs, status codes, rejection handling, retry rules and settlement timing.
- [ ] Confirm statement/reconciliation APIs, identifiers and permissions.
- [ ] Validate service keys safely before storing them; NetConnector status `001` is credential validation only, not proof of a payment contract or live transaction capability.
- [ ] Replace inferred client paths/fields with verified provider contracts.
- [ ] Implement authenticated callbacks that fail closed, reject replay and process duplicates idempotently.
- [ ] Prove successful, failed, cancelled, timed-out and duplicate-callback cases in the sandbox.
- [ ] Reconcile provider transactions to CRM `Payment`, ledger and statement records without duplicate postings.
- [ ] Assign named ownership for payment exceptions, failed mandates, reversals, refunds and settlement differences.
- [ ] Connect monthly billing to real Netcash collection only after mandates and reconciliation are proven.
- [ ] Complete controlled sandbox UAT and obtain business approval before production activation.

**Exit criteria:** verified provider contract and credentials; authenticated/idempotent callbacks; passing sandbox scenarios; reconciliation and exception ownership; approved production configuration; controlled live proof. No real money may move before these gates pass.

## 2. Hikvision / HikCentral access control

**Status: BLOCKED — pending API information, trusted connectivity and approved mappings.**

The administration and encrypted configuration capability exists, but configuration screens are not proof of physical access control.

- [ ] Obtain the approved HikCentral OpenAPI base URL, version, App Key/App Secret and vendor documentation.
- [ ] Resolve the current untrusted HikCentral TLS certificate chain; do not disable certificate verification as a workaround.
- [ ] Confirm the Midpoint HikCentral organisation identifier and exact approved door index codes.
- [ ] Decide and document the direct CRM-to-HikCentral versus n8n/provider responsibility boundary.
- [ ] Approve the POPIA/data-processing boundary for facial/biometric data, retention, consent, subject requests and operator access.
- [ ] Configure production credentials through the write-only encrypted administration path without exposing them in source, logs or task trackers.
- [ ] Prove a live connection test and auditable provider health state.
- [ ] Prove customer enrolment, assignment to the correct facility/door and successful physical entry.
- [ ] Prove revocation on move-out and confirm access is removed at the physical system.
- [ ] Test provider outage, timeout, partial failure, retry/idempotency and reconciliation behaviour.
- [ ] Define manual fallback and incident ownership when access provisioning or revocation fails.

**Exit criteria:** trusted TLS, approved credentials/mappings and POPIA boundary; successful live enrolment/entry/revocation; failure and reconciliation evidence; named operational owner.

## 3. Public booking and account-state UAT

**Status: READY ONLY WITH EXPLICIT APPROVAL AND A CONSENTING TEST RECIPIENT.**

- [ ] Complete one clean public rental journey through real CAPTCHA and mobile verification; automation must not bypass either control.
- [ ] Complete the separate email-verification step where the Pay Now/simulator journey requires it.
- [ ] Confirm the CRM records the correct customer, lead/reservation, unit, hold deadline, consent choices and communication outcomes.
- [ ] Confirm the 24-hour verified hold and correct South African time presentation.
- [ ] Cancel or expire the disposable reservation and prove the unit returns to live availability.
- [ ] Complete a fresh reserve-to-view UAT inside configured office hours and prove the corrected hold/appointment rule.
- [ ] At the next legitimate move-in, verify that the pending account immediately shows the selected unit, monthly rate and `Pending lease signature`, then changes to active occupancy only after the authenticated BlendSign completion callback.
- [ ] Retain record IDs, audit events and communication evidence before authorised cleanup.

Do not create a real lease solely to manufacture evidence for the pending-account display.

## 4. Unit-transfer legal document and signing gate

**Status: ON HOLD — Legal approval required.**

Asana task `1217529587240241` must remain on hold until Legal decides:

- [ ] Addendum versus replacement agreement.
- [ ] Effective-date rule.
- [ ] Treatment of an existing or amended debit-order/payment mandate.
- [ ] Deposit, pro-rata adjustment, transfer fee and rental-change wording.
- [ ] Required signatories, countersigning and execution rules.
- [ ] How the original executed agreement is linked and marked amended/superseded without alteration or deletion.
- [ ] Final approved template content and version control.

After approval:

- [ ] Implement the approved BlendSign template and merge-field contract.
- [ ] Hold the destination unit provisionally while signing is outstanding.
- [ ] Activate the CRM transfer only after valid completion, then release the old unit.
- [ ] Link both documents to the tenancy/account and retain immutable audit evidence.
- [ ] Prove retry, cancellation, expiry and concurrent-destination-claim behaviour.

## 5. MRI/MDA finance integration

**Status: BLOCKED — integration and ownership decisions outstanding.**

- [ ] Confirm whether MRI or MDA is the authoritative finance destination and name the accountable business/system owner.
- [ ] Select and approve the integration method: API, SFTP/file exchange or controlled manual import.
- [ ] Obtain sandbox/test access and authoritative file/API specifications.
- [ ] Approve customer, lease, unit, charge, payment, tax, deposit and chart-of-account mappings.
- [ ] Define posting timing, period controls, batching and source identifiers.
- [ ] Define reconciliation, duplicate prevention, correction, reversal and replay rules.
- [ ] Assign owners and service levels for rejected postings and reconciliation exceptions.
- [ ] Replace the deliberate `mri://pending-integration-decision` placeholder only after the contract is approved.
- [ ] Prove a non-production export/import and reconcile totals and individual records before live activation.

## 6. WhatsApp lifecycle automation

**Status: IMPLEMENTED, CONFIGURED IN PART, BUT GENERAL AUTOMATION MUST REMAIN DISABLED.**

- [ ] Obtain an approved consenting South African UAT number and explicit approval immediately before controlled sends.
- [ ] Confirm every approved template SID, variable mapping and intended lifecycle trigger.
- [ ] Verify E.164 normalisation for local and `27...` inputs.
- [ ] Verify signed status callbacks for queued, sent, delivered, read and failed states.
- [ ] Verify inbound replies create the correct facility-scoped task.
- [ ] Verify STOP-style responses revoke consent and prevent later automated sends.
- [ ] Verify delivery failures create actionable tasks and controlled retry does not duplicate messages.
- [ ] Verify the owner-only automation switch and the server safety gate both fail closed.
- [ ] Decide whether telephone/voice is required; if so, select a provider, consent basis and operating workflow separately.
- [ ] Obtain business approval before changing `WHATSAPP_AUTOMATION_ENABLED=false`.

## 7. Insurance configuration

**Status: BLOCKED — approved commercial terms missing.**

- [ ] Supply the approved insurer/provider, product, cover limits, premiums, excesses, exclusions and policy wording.
- [ ] Confirm opt-in/mandatory rules, disclosures, cancellation and claim responsibilities.
- [ ] Configure only approved values; do not invent commercial terms.
- [ ] Prove enrolment, billing treatment, cancellation on move-out, reporting and reconciliation.

## 8. Offline/PWA operational proof

**Status: CORE CAPABILITY DEPLOYED; FINAL OPERATIONAL EVIDENCE OPEN.**

- [ ] Run the planned two-device race using the same available unit and prove exactly one server claim succeeds.
- [ ] Confirm the losing device receives a conflict, refreshes encrypted availability and preserves its encrypted queue.
- [ ] Verify cold offline launch, unlock, expiry warnings, hard expiry, reconnection and cache replacement after a later release.
- [ ] Verify post-sync receipts contain no customer PII and match CRM records/audit evidence.
- [ ] Verify failed/stale queue monitoring and staff recovery steps.
- [ ] Keep offline payments, leases, documents and biometric changes blocked; they are not part of the approved offline boundary.

## 9. Security and access administration

- [ ] Implement and live-prove MFA for the separate `stor24-cms` administrative surface.
- [ ] Enrol every remaining CRM administrator and facility manager in MFA individually; retain recovery and audit evidence.
- [ ] Review and remediate outstanding dependency advisories in controlled upgrades. The public site currently reports known npm/Next.js advisories; do not apply a forced breaking upgrade without a tested migration.
- [ ] Complete outstanding route-level integration/security coverage, especially financial callbacks and cross-system failure boundaries.
- [ ] Reconfirm branch protection, secret rotation ownership, least privilege and recovery access before go-live.

## 10. Monitoring, recovery and support readiness

- [ ] Stabilise the scheduled external production monitor, which has produced timeout failures while direct health checks were healthy.
- [ ] Ensure monitoring distinguishes public site, CMS, CRM/database, BlendSign, messaging and future provider failures.
- [ ] Define alert recipients, severity, response times and escalation paths.
- [ ] Prove backup restoration and document recovery objectives.
- [ ] Rehearse provider outage and degraded-mode procedures.
- [ ] Assign ongoing application, database, infrastructure, provider and business-process ownership.

## 11. Migration, data and cut-over

- [ ] Obtain an authorised legacy operational export; never commit populated customer exports or paste sensitive data into task trackers.
- [ ] Map and validate organisations, facilities, units, customers, reservations, tenancies, balances, documents and identifiers.
- [ ] Run a repeatable non-production migration rehearsal with counts, rejects and reconciliation evidence.
- [ ] Define data cleansing, duplicate handling, correction and rollback procedures.
- [ ] Approve the cut-over window, freeze rules, delta migration, rollback decision and named sign-off authority.
- [ ] Complete the production migration only under an approved runbook and reconcile before opening operations.

## 12. Training and business acceptance

- [ ] Refresh training material against the final live screens and approved workflows.
- [ ] Train administrators, facility staff, finance/reconciliation users and support owners by role.
- [ ] Cover booking, reservations, move-in, signing, transfers, move-out, offline recovery, audit, communications and exception handling.
- [ ] Record attendance, competency/UAT results and unresolved questions.
- [ ] Obtain named business approval for pilot/go-live and retain outstanding exclusions explicitly.

## 13. Public-site residual QA

- [ ] Complete cache-busted production visual checks for the supplied Office Pack ladder and expanded Small office assets.
- [ ] Complete a full live 124-piece Large office calculation/render and record timing and browser behaviour.
- [ ] Investigate or formally accept the three non-blocking embedded-texture blob warnings from supplied GLBs.
- [ ] Keep the calculator-to-booking area regression in the permanent test suite. The 33 m² defect is fixed and live-proven; Units 361/362/363 must never reappear as recommendations for that journey.

## 14. Tracker and governance reconciliation

- [ ] Re-read the live Asana programme before changing task states; the last evidence snapshot recorded 46 tasks, 21 closed and 25 open, but that count is not confirmed current and is not a weighted completion percentage.
- [ ] Align each relevant Asana task with this register and the canonical repository context.
- [ ] Close tasks only with implementation, test, promotion, deployment/configuration and required live/UAT evidence.
- [ ] Keep provider, Legal, data, training and approval gates open until the responsible external owner supplies and approves them.

## Completed work that must not be reopened without new evidence

- [x] Calculator-to-booking 33 m² filtering defect fixed and live-proven on all three Midpoint floors.
- [x] CRM customer/lead ownership established; CMS shadow customer/deal ownership removed.
- [x] Organisation-owner CRM MFA proven.
- [x] Public quote-to-CRM lead flow previously proven.
- [x] Standard and debit-order BlendSign journeys proven, including sealed documents/certificates.
- [x] BlendSign invalid-signature rejection, reminder cooldown/idempotency and provider-outage retry acceptance proven.
- [x] Reservation extension and expiry lifecycle proven.
- [x] Maintenance `AVAILABLE -> SERVICE -> AVAILABLE` lifecycle proven.
- [x] Transfer lifecycle and destination atomic claim proven; only the Legal signing-document gate remains.
- [x] Zero-balance/no-deposit move-out lifecycle proven.
- [x] Real-time availability recalculation across reservation, lease, maintenance, transfer and move-out proven.
- [x] Public single-store Midpoint routing, direct booking and CMS hero delivery deployed and live-read back.

## Definition of programme completion

The programme is complete only when every required capability is implemented, permission-scoped, audited and tested; all required provider contracts and configuration are approved; deployment revisions are verified; live end-to-end UAT passes; migration, training, monitoring, recovery and support ownership are accepted; and the business gives named production approval. Code, CI, a successful deployment or an HTTP health response alone is insufficient.
