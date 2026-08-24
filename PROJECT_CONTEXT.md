# STOR 24 CRM and Operations Platform — Project Context

> Last reviewed: 20 August 2026. Read this file before planning or changing the repository. Update it whenever a material capability, decision, deployment state, or cross-repository contract changes.

## Product identity and non-negotiable boundary

This is **STOR 24**, not SiteLink. It is a purpose-built CRM, operations, leasing, reservation, reporting and integration platform. Other products supplied research evidence only and must not appear as the product identity.

Official CI is documented in `docs/STOR24_BRAND_CI.md`. Use the approved logo files in `public/brand/`, ink `#071411`, cream `#F5F3EA`, orange `#FF5A0A`, and Satoshi typography.

## Repository role

This repository is the internal STOR 24 CRM and operations portal. Despite the GitHub repository name `stor24-portal`, it is not the public marketing website. It owns staff-facing operational truth and exposes a narrowly sanitised public-booking API to the website.

- Repository: `blendproperty/stor24-portal`
- Primary branch: `main`
- Stack: Next.js 16, React 19, TypeScript, Prisma 7 and PostgreSQL
- Canonical transactional schema: `prisma/schema.prisma`
- Architecture: multi-organisation, multi-facility modular monolith

## Branching policy

Branches exist only as short-lived rollback/review points before merging into `main`. Open a branch, get it reviewed and merged, then delete it immediately.

## Netcash payment provider scaffold — 20 August 2026

Brett supplied links to Netcash's developer docs (eMandate synchronous, DebiCheck, Netcash statement, Pay Now, standard debit orders, AVS) and asked for this to be scaffolded as the payment solution that reconciles and sends to MRI.

**What was built, all on `main`:**

- `src/lib/payments/netcash-client.ts` — low-level REST client covering all six Netcash products Brett linked: eMandate (synchronous), DebiCheck (mandate + collection), standard debit orders, Pay Now (hosted checkout), AVS (bank account verification), and statement retrieval. Reads credentials from an `IntegrationConnection` row (`category: "PAYMENTS"`, `provider: "NETCASH"`) rather than raw env vars — matches how every other external provider in this repo is configured, so no schema change was needed.
- `src/lib/payments/netcash-service.ts` — orchestration layer billing-service.ts and staff UI should call: `verifyCustomerBankAccount`, `setUpRecurringCollection` (DebiCheck mandate), `collectMonthlyRent` (submits a collection against an existing mandate, idempotent per account+date), `createOnceOffCheckout` (Pay Now, for deposits/arrears/ad-hoc charges), `submitFallbackDebitOrder` (standard debit order for accounts not on DebiCheck), `getNetcashStatementForReconciliation`. Every call writes/updates a `Payment` row (`provider: "NETCASH"`) and tracks `IntegrationConnection` health (`lastSuccessAt`/`lastFailureAt`/`consecutiveFailures`) the same way other providers are tracked here.
- `src/app/api/webhooks/netcash/route.ts` — inbound notify/callback endpoint. Persists every inbound call verbatim to `WebhookInbox` first (so nothing is lost even if processing throws), matches by `providerRef` to a `Payment`, and on success creates the corresponding `LedgerEntry` (type `PAYMENT`) and enqueues an MRI export. On failure, marks the `Payment` `FAILED`.
- `src/lib/finance/mri-export.ts` — **generic scaffold only, not a real MRI integration.** The MRI decision pack (API vs SFTP file drop vs manual CSV import, exact field mapping, chart-of-accounts mapping) is still open — see Priority next work. This module reuses `WebhookOutbox` as a durable, retryable "ready to export to finance" queue (`destination: "mri://pending-integration-decision"`, a placeholder) so that once the actual MRI integration method is decided, a worker can be pointed at this queue without touching billing-service.ts or the Netcash integration again.

**Deliberately reused existing schema — no migration required.** `Payment`, `LedgerEntry`, `IntegrationConnection`, `WebhookInbox` and `WebhookOutbox` already existed and already cover everything this integration needs (provider/providerRef tracking, idempotency keys, health tracking, durable retryable queues). Nothing new was added to `prisma/schema.prisma`.

**NOT YET LIVE — explicit gaps, in priority order:**

1. **No real Netcash credentials exist anywhere.** No `IntegrationConnection` row has been created for `provider: "NETCASH"` in any environment; every call will throw `NETCASH_NOT_CONFIGURED` until one is created (with real service keys) via whatever admin flow ends up managing `IntegrationConnection` rows.
2. **Endpoint paths and field names in `netcash-client.ts` are best-effort, not confirmed.** The six Netcash docs pages Brett linked were too large to fully read in this environment (each exceeded the fetch tool's output limit); only partial content was captured (e.g. confirmed `ServiceKey` and `BankAccountNumber#` field names for one product). The rest of the field names (`Reference`, `AccountHolderName`, `CollectionAmount`, etc.) and every endpoint path are inferred from Netcash's general API conventions, not verified against the actual docs. **Every endpoint path and payload shape must be checked against Netcash's live documentation (or a sandbox account) before this is used for a real transaction.**
3. **Webhook signature verification is a stub.** `src/app/api/webhooks/netcash/route.ts` has a `// TODO: verify authenticity` comment where Netcash's actual callback signing/hash scheme needs to go. Right now anyone who knows the webhook URL could POST a fake "payment succeeded" event. This must be fixed before going live — it is the single most important gap for security, not just correctness.
4. **No sandbox testing has been done at all.** None of the six functions in `netcash-service.ts` have been exercised against Netcash's sandbox or production, by this assistant or (as far as recorded here) by Brett.
5. **MRI export is a queue with nowhere to go yet** — by design, per the still-open MRI decision pack. `mri-export.ts` needs a real destination (API client, SFTP writer, or scheduled CSV export) once that decision is made.

## Sign-in security hardening — 19 August 2026

Brett asked for a security audit of sign-in/auth across all three repositories ("harden and secure the website for sign-in and prevent hacking"). Full audit findings and fixes below; this repository (the CRM, highest-privilege sign-in surface) was already the most solidly built of the three.

**What was already solid here, confirmed by direct code review (not assumed):**
- Custom JWT auth via `jose`, not a third-party auth library; bcrypt cost-12 password hashing.
- Double-layer authorization: `src/proxy.ts` middleware verifies the session on every request *and* independently re-checks `user.active`/`sessionVersion` against the database — a stolen or stale cookie doesn't survive a password change or deactivation.
- `src/lib/auth-guards.ts` (`requireSession`, `requirePermission`) does a second, independent DB-backed check per route with facility-scoped RBAC, not just a client-side gate.
- Login route: DB-backed rate limiting (5 attempts/15 min), constant-time comparison to resist user-enumeration timing attacks, all attempts audit-logged.
- Cookies: `httpOnly`, `secure` in production, `sameSite: lax`, 8-hour expiry — no token ever stored in localStorage.
- Password policy: 12+ characters, requires mixed case, digit and special character (`src/lib/validators.ts`).
- Server-to-server endpoints authenticate via SHA-256-hashed shared secrets checked with `timingSafeEqual` (separate path from the CSRF/Origin check below, unaffected by that change).

**Fixed this session:**
- **CSRF gap in `src/lib/request-security.ts`.** `sameOrigin()` previously returned `true` when the `Origin` header was simply absent (`!origin || allowed.has(origin)`) — a real bypass, since a crafted cross-site request that omits `Origin` would sail through. Browsers always send `Origin` on same-site mutating fetch/XHR/form requests, so the fix now requires `Origin` to be present and allow-listed for any non-safe HTTP method (`POST`/`PUT`/`PATCH`/`DELETE`), while leaving safe methods (`GET`/`HEAD`/`OPTIONS`) unaffected.
- **No security headers at the app layer.** Added `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, HSTS (`max-age=63072000; includeSubDomains; preload`) and a same-origin-only Content-Security-Policy in `next.config.ts` via `headers()`. This is the staff sign-in surface, so it got the strictest CSP of the three repositories (no external script/style/connect sources at all).

**Not fixed this session — needs follow-up:**
- **No 2FA/MFA.** Both this repository's staff login and `stor24-cms`'s admin login are password-only. Worth prioritising for owner/admin-level accounts given the operational data this system holds. Not implemented yet — flagged for a dedicated pass, not a quick patch.
- Password-reset token expiry enforcement was reviewed but not exhaustively traced end-to-end during the audit; creation/hashing (SHA-256, random 32 bytes) looked correct.
- CVE/dependency cross-check against `bcryptjs`, `jose`, `prisma`, `next` versions was not performed — versions are current-generation but not individually checked against known advisories.

## Implemented foundations

- Database-backed authentication, password recovery, invitation flow, sessions, RBAC and security audit events.
- Organisation and facility scoping with permission checks on protected server routes.
- Facility, inventory, unit, map and configuration foundations.
- Customer, lead, reservation and leasing foundations, including scoped service logic.
- **Public lead capture (`POST /api/public/v1/leads`), added 18 August 2026.** For the marketing site's general "get a quote" form (no unit selected). `src/lib/public-lead-contract.ts` + `src/lib/public-lead-service.ts` create a real `Customer` + `Lead` (`stage: "NEW"`, `source: "PUBLIC_QUOTE_FORM"`). Same auth/rate-limiting pattern as `/api/public/v1/reservations`. **Built to correct a mistake:** an earlier version wrote leads into the CMS's `contacts`/`deals` collections — reverted the same day. **Code-complete, not yet live-tested.**
- **Executive reporting dashboard (`/graphs`, rebuilt 18 August 2026) — real data, not synthetic.** New `src/lib/dashboard-service.ts` runs real, facility-scoped Prisma queries: KPI set, occupancy trend, lead pipeline funnel, billed-vs-collected revenue chart, 7-day new-leads chart, unit-status-by-facility table. **Code-complete, pushed to `main` 18 August 2026, not yet live-tested or build-verified by the assistant.**
- **Reservation-to-tenancy lifecycle (`src/lib/leasing-service.ts`) is real and database-backed.** `moveIn()` is now (18 August 2026) a two-phase send-and-sign flow — see Lease e-signature below.
- **BlendSign lease routing, added and deployed 21 August 2026; completion-gateway fix pending deployment.** The staff move-in form requires a payment method. `DEBIT_ORDER` routes to `stor24-unit-lease-debit-order`; card, EFT and other route to `stor24-unit-lease`. A server-only client creates an idempotent BlendSign envelope, maps known customer/unit/lease values, stores the external envelope reference on `Document`, and the signed `envelope.completed` webhook activates the pending occupancy and tenancy. The code was merged to organisation `main` in merge commit `acfb8b8` and first deployed successfully in run `32452208716`. **Server configuration is complete:** a new Stor24-company BlendSign API key and an active `envelope.completed` webhook for `https://stor24-site.srv938083.hstgr.cloud/api/webhooks/blendsign` were created; `BLENDSIGN_BASE_URL`, `BLENDSIGN_API_KEY` and `BLENDSIGN_WEBHOOK_SECRET` were stored as encrypted repository secrets and written to `/opt/stor24-crm/.env` by successful configuration run `32454944047`. Values were never printed or committed. Verification run `32455134137` deployed exact commit `46b04d9`, built the app and migration images, found all 22 migrations with none pending, recreated the app and passed health checks. Standard-lease UAT then completed both BlendSign signatures and delivered both sealed copies, but left the Stor24 tenancy `DRAFT` and unit 104 `RESERVED`. Root cause: `src/proxy.ts` did not classify `/api/webhooks/blendsign` as public, so the session proxy returned `401 UNAUTHENTICATED` before the route's HMAC check. The narrow fix exposes only that webhook path; the route still requires the configured HMAC signature. Regression coverage plus all 40 tests, typecheck, lint (three pre-existing warnings) and a full Next.js production build pass locally. Production deployment and an end-to-end activation re-test remain required before Task 4 closes. The legacy `/sign/[token]` flow remains for existing records. Completed-PDF/certificate retrieval and retry/reconciliation UI remain outstanding.
- **BlendSign signer-experience and optional authorised countersigning subtask, deployed and published 21 August 2026.** Stor24 now sends only `tenant.phone` (the duplicate `tenant.telephone` merge value is removed). The final template PDFs use one Mobile number row. BlendSign provides city selection/postal autofill and clearer `Signed at`/final-execution guidance. Facility Program Defaults > Move In now has a separate `blendSignAutoCountersign` control; when true, only the Stor24 Rep recipient is flagged for BlendSign auto-signing. BlendSign must independently have an authorised representative, signature, initials and company permission enabled, otherwise it rejects the auto-sign request. Leave the Stor24 control off for manual UAT. Local evidence: all 40 tests, typecheck and the full Next.js production build pass. Deployment evidence: BlendSign run `32465911894` deployed commit `573eb54`; Stor24 run `32465970915` deployed commit `28217cc`. Live template evidence: standard `stor24-unit-lease` is v7/36 fields and debit order `stor24-unit-lease-debit-order` is v4/52 fields; both legacy debit-order date clauses on pages 7 and 8 were visually verified corrected.
- **Task 4 standard-lease UAT completed successfully on Unit 106, 21 August 2026.** Account `ST24-MT2R27J7` began as `DRAFT` while BlendSign envelope `cmt2r27ve008y2b2hro2xfphk` was `SENT`. John Wayne signed at 11:36 and Brett Dovey manually countersigned at 11:39 with auto-countersigning off. The valid completion webhook then changed the tenancy to `ACTIVE`, linked Unit 106, showed `Active occupancy`, unit type B2 and R100 monthly rent, and both recipients received the completed PDF. This closes the unit-104 proxy-defect remediation and authorises debit-order Task 5.
- **Task 5 debit-order UAT follow-ups, 21 August 2026.** Earlier Unit 103 testing exposed repeated inputs and defaulting issues; these were remediated in BlendSign. Unit 101 then provided fresh live evidence that the Storer could complete the debit-order signing flow and that the enabled Stor24 authorised-signing configuration automatically countersigned and produced a sealed PDF. The unsigned-review protection was also tested: incomplete copies use a Stor24-coloured `UNSIGNED DRAFT` / `NOT A VALID OR EXECUTED AGREEMENT` watermark, footer, envelope reference and timestamp. A post-signing race initially left the stale unsigned-review button label visible while its route served the already-sealed PDF; BlendSign commit `0b8b83c`, deployed successfully in run `32483284542`, now polls completion and locks each URL to either the watermarked review or sealed completed state. Task 5 is not yet closed: explicitly verify the Unit 101 Stor24 account changed to `ACTIVE`, the correct unit/rent/deposit/debit values persisted, both recipients received the completed PDF, and the final PDF contains no draft watermark. Debit-order contact person defaults to the Storer name but remains signer-editable for a company/different contact. Initial move-in charge must later default from the selected unit price (then facility default), be locked for ordinary staff, allow Facility Manager/Owner/Admin override only, and audit original value, replacement value, actor, timestamp and reason.
- **Task 6 completed-document retrieval started 24 August 2026.** Code on isolated branch `codex/task6-document-retrieval` adds a facility-scoped, permission-checked Stor24 proxy for completed BlendSign PDFs and completion certificates. The server-side BlendSign API key never reaches the browser; only signed `LEASE_AGREEMENT` documents linked to an authorised organisation/facility can be downloaded, and each download writes an audit event. The Accounts workspace exposes Completed lease and Completion certificate actions only after the document is `SIGNED`. Companion BlendSign branch `codex/task6-integration-downloads` permits the existing company-scoped API key to retrieve the signed PDF/certificate while preserving normal signed-in company access. Local evidence: Stor24 typecheck, lint (three pre-existing warnings), all 40 tests and production build pass; BlendSign TypeScript and production build pass. Not complete or deployed: both branches still need review/merge/deployment, then a live Unit 101 or disposable completed envelope must prove PDF/certificate retrieval, facility denial and audit evidence.
- **Reservation cancellation (`DELETE /api/v1/reservations?id=`) — live-tested 18 August 2026** (unit 104, cancel confirmed end to end).
- Operations tasking, company-setup workspaces, report catalogue/exports/schedules, provider-neutral integration contracts, versioned communication templates, reservation-confirmation notifications (email leg live-tested via SendGrid; SMS/WhatsApp blocked on Twilio trial-plan restrictions).
- Automated monthly rent billing (`billing-service.ts`) — live-tested (reachable, authenticated, idempotent), zero-charge result at time of test since no ACTIVE occupancy existed yet. **Not yet wired to `netcash-service.ts`** — see Priority next work.
- **Netcash payment provider scaffold (20 August 2026)** — see dedicated section above. Code-complete, zero live testing, credentials not configured anywhere.
- Public booking API, transactional unit claiming, HikCentral biometric access code (disabled pending production config), Docker deployment, move-in unit-selector filtering (visually confirmed live), take-payment reference auto-generation (code-only).

## Ownership decision — APPROVED 17 August 2026, reaffirmed 18 August 2026

**Approved by:** Brett Dovey, Blend Property Group.

```text
STOR 24 CRM (this repository) — operational system of record
  operational customers, leads, deals, facilities, units, reservations,
  leases, workflows, communications, access intent and operational audit
  — this is the ONLY place customer/lead/deal data should live

STOR 24 public portal — customer presentation, captures leads but stores
  them in the CRM

STOR 24 CMS — editorial only, nothing CRM-shaped

MRI Property Central — approved finance system of record
```

**Resolved 18 August 2026:** the CMS's live CRM-shaped collections (`contacts`, `deals`, `activities`, `units`) and their five dashboards were removed from `stor24-cms` — see that repository's `PROJECT_CONTEXT.md`. Brett liked the visual style of those now-removed dashboards; the new `/graphs` executive dashboard in this repository (see Implemented foundations) is the corrected, properly-owned version of that reporting experience.

## Priority next work

1. **Get real Netcash sandbox/production credentials and confirm every endpoint path and field name in `netcash-client.ts` against Netcash's actual docs** — the scaffold built 20 August 2026 is unverified (see "Netcash payment provider scaffold" above for the exact gap list). This is now the top blocker for the payment work, ahead of item 2 below.
2. **Implement real webhook signature verification in `src/app/api/webhooks/netcash/route.ts`** before this is exposed on a real domain — currently anyone who finds the URL can fake a successful payment.
3. **Wire `billing-service.ts`'s monthly cron to call `collectMonthlyRent` from `netcash-service.ts`** once mandates exist — currently the cron and the Netcash integration are built but not connected to each other.
4. **Decide the MRI integration method** (API, SFTP, manual CSV) so `src/lib/finance/mri-export.ts` can be pointed at a real destination instead of the placeholder `mri://pending-integration-decision`.
5. Unblock SMS/WhatsApp (Twilio trial-plan restrictions — needs a real number + account upgrade).
6. Confirm monthly billing cron picks up the now-`ACTIVE` Blend Group/unit 360 tenancy with a nonzero charge.
7. Select Hikvision access provider — still a hard blocker for pilot scope (South African payment provider is now Netcash, pending the verification work in item 1).
8. Close the remaining debit-order Task 5 evidence for Unit 101: confirm Stor24 account activation, retained commercial/debit values, both completed-copy deliveries and a clean final PDF. The v4/52-field send/sign/auto-countersign and unsigned-versus-completed document-state controls are already proven. After UAT, add completed-PDF/certificate retrieval plus retry/reconciliation UI.
9. **Live-verify the public leads API and the `/graphs` dashboard** — check the `Deploy to VPS` Actions run for a green build, then confirm both work against real production data/traffic.
10. **Implement 2FA/MFA for staff/owner accounts** — flagged 19 August 2026 during the sign-in security audit as the highest-value remaining auth gap.
11. **Repository review fixes recorded 24 August 2026:** authenticate and safely expose Netcash callbacks after the official provider contract is confirmed; enforce facility scope on leasing customer results; validate reservation/lead ownership and lifecycle during move-in; and resolve dependency advisories plus route-level integration-test gaps. These are tracked separately in Asana and are not silently included in Task 6.

## Working rules for any AI assistant (selected, most relevant)

1. Inspect branch, status, recent commits, schema and route/service code before making claims or changes.
2. Never deploy, migrate production data, or create real customer records without explicit authority.
3. This environment cannot run `npm run build`/`npm run check` or query the production database directly — say so explicitly rather than implying build/live confidence from code review alone. Verify via the `Deploy to VPS` Actions log.
4. Don't add a new npm dependency to a repo whose Docker build uses `npm ci` unless the lockfile can actually be regenerated correctly — prefer dependency-free solutions (e.g. hand-rolled SVG/CSS charts) when it can't.
5. When a fix touches customer/lead/deal data, check which system is supposed to own it (see Ownership decision) before picking where to write it.
6. When making a large text-file edit via a tool requiring full replacement content, double-check the content variable actually contains the full intended file before submitting — not a placeholder.
7. Update this file after every material change, with dated evidence, not optimistic status language.
8. This environment has no tool to change GitHub repository Settings (e.g. enabling Actions, branch protection) — those changes require the user to make them directly in GitHub's web UI. Don't imply this can be automated from here.
9. **Security fixes need the same evidence discipline as feature work.** A CSRF/header fix pushed to `main` is not "secured" until it's deployed and, ideally, spot-checked live — don't let the language in this file imply otherwise.
10. **When scaffolding a third-party financial integration from docs pages too large to fully read in this environment, say exactly which parts were verified vs inferred — don't let generated code read as more confirmed than it is.** The Netcash scaffold (20 August 2026) is the reference example: field names for five of six products are unverified and this is stated explicitly in the code comments and in this file, not glossed over.

## Definition of done

A CRM capability is complete only when it is database-backed, scoped, permission-enforced, audited, tested, operationally owned and — where an external provider or deployment is involved — configured and proven end to end with reconciliation and exception handling.

**Note on this revision:** condensed from a much longer version to reliably get through after repeated tool timeouts — full historical detail (e-signature v1/v2/v3 narrative, reservation-cancel proof steps, deployment gotchas, numbered working rules 1–23) remains in git history at commit `1f1b4393`/`09cc0a8e`/`04fead0e`/`377eb088` and should be restored/merged forward on the next substantial edit rather than left condensed indefinitely.
