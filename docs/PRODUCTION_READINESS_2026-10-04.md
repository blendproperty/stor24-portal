# STOR24 production readiness — 4 October 2026

Status: engineering hardening deployed and read-only verified; full production acceptance remains open.

## Validated release and private staging evidence

- Implementation `b841042ab7c05a85a99834c849249bb9678a8833` passed all nine PR checks: CI `37206593092` (532 tests, build/typecheck/lint and complete browser suite), security `37206593086`, isolated PostgreSQL transactions/restore `37206593103` and CodeQL `37206591818`. PR #379 merged as `fcbdbfd5a9aca2fa759c50ffe717c62727ac1069`; fetched complete tree equals the tested source. Mainline CI37207297915, security37207297911 and transactions37207297923 passed; deployment37207936162 succeeded.
- Clean local lockfile installation, full build, TypeScript and 532 tests passed; lint zero errors/seven existing warnings. Initial dependency-junction build failure was resolved by the clean installation.
- Fresh encrypted production archive restored at `2026-10-04T13:43:15Z`: 78 tables, three seconds, no network and no production DB writes. This proves local database restoration, not independent key/host-loss recovery.
- Isolated CI database read probe: 340 requests at 10/25/50 concurrent readers; zero errors; ten connections; worst p95 189 ms. Server resource probe: disk52%, available memory65%, six/seven connections out of100, healthy app/no OOM. Candidate production Compose validates on the host.
- Private technical staging is running from the exact merged source at `/opt/stor24-staging`, with a persistent separate database, independent random DB/signing secrets, internal-only Docker network, no published ports and no production/provider credentials. App/database each have one CPU/1 GB/256 PIDs and bounded logs. Fresh versioned migrations bootstrap an empty database; customer count is zero. This is not representative authenticated business UAT.
- Staging HTTP/database health probe at `2026-10-04T13:59:31.450Z`: 340 requests at 10/25/50 readers, zero errors, worst p95 599 ms. At `2026-10-04T14:00:04Z`, the staging app switched to retained image `bc47f71f5`, passed health and restored healthy candidate `fcbdbfd5a`. Schema compatibility was checked first; production was unchanged. Initial host-port probe was refused by network isolation; the successful probe executes inside the staging app namespace, and the staging specification publishes no ports.

Staging definition and bounded probe are retained in `compose.staging.yml` and `scripts/test-staging-health-capacity.mjs`. Evidence files are also retained outside Git in `Sitelink/output/production-readiness-20261004`. There is no application AI-provider SDK/configuration in the inspected source; OpenAI budget controls are currently not applicable. Provider SMS/payment/document costs still require operational consumption and budget ownership.

Final staging/runbook/evidence source `d5d36ab0033069255d675d754cbace3af0323e15` passed all nine exact-head checks: CI37208701719, security37208701715, isolated transactions/restore37208701727 and CodeQL37208699547. PR #380 merged as `bbbe4ea410f7d910380ecbfafc8c3fca1a21ec1d`; fetched full tree equals tested source. Its production app/schema/image/pipeline tree is unchanged from the live-tested hardening release. The probe was corrected after static analysis flagged browser-style HTTP and CodeQL identified a predictable temporary-file write; no suppressions or alert dismissals. Final probe uses a bounded fixed-loopback Node request and emits JSON only. Actual final execution at `2026-10-04T14:17:11.846Z` passes 340 requests / zero errors / worst p95 710 ms. Capture its stdout with an exclusive random file in a private evidence directory; the probe itself creates no temporary files.

## Production runtime verification

Deployment `37207936162` succeeded for exact merged source `fcbdbfd5a9aca2fa759c50ffe717c62727ac1069`. Healthy image `stor24-crm:fcbdbfd5a`, digest `sha256:0ba01bf6ecac076ab801124c61f6c4fbd05a47043cc4f170f05e91f274f52f1f`, started `2026-10-04T14:06:59.400275212Z`. App and PostgreSQL runtime limits verify two CPUs / 2 GB / 256 PIDs and three 10 MB log files. PostgreSQL was updated without restart; Docker required the compatible 4 GB memory-plus-swap setting, and the host has no swap.

At `14:08:23Z`, production app/database/resource/backup health passes: disk54%, available memory63%, seven DB connections of100, no app OOM. Released adapter configuration was tested read-only against production PostgreSQL at `14:08:49.910Z`: pool10, acquisition5s, statement30s, idle-transaction60s. Public health/booking return200; anonymous staff users/report export/public CRM API return401 with private no-store. Fresh pre-migration encrypted backup completed `14:05:00Z`, still `offSite:false`.

Production monitor run `37208198253` and monthly isolated restore run `37208200272` both pass on the released SHA. This verifies workflow execution; named ownership/delivered failure-alert acceptance and independent off-server recovery remain open. No production business-record/provider action was submitted.

## Private staging operation

Use the dedicated `/opt/stor24-staging` checkout and root-restricted `.env.staging`; never copy production `.env` or production records/provider credentials. `IMAGE_TAG` must select the tested retained image. The internal network intentionally exposes no browser/public ingress. Human workflow testing requires a separately approved access method and synthetic data/roles.

Fresh initialization only: `docker compose --env-file .env.staging -f compose.staging.yml up -d postgres`, then `run --rm bootstrap` once. The bootstrap refuses populated schemas. Subsequent reviewed migrations use the migrator image's ordinary `prisma migrate deploy` command, not the empty bootstrap. Start/update only the stage app with `up -d --no-deps app`.

Readiness: `docker exec stor24-readiness-staging-app-1 wget -qO- http://127.0.0.1:3000/api/health`. Bounded probe: `docker exec -e STOR24_STAGING_CAPACITY_TEST=isolated-loopback -i stor24-readiness-staging-app-1 node --input-type=module < scripts/test-staging-health-capacity.mjs`. The tool refuses environments lacking the synthetic staging marker. Preserve the resulting report before app recreation.

Before switching images, prove schema compatibility and availability of the previous image, retain the intended candidate tag, and restore it even if the rehearsal fails. A staged health-only rollback does not prove all financial/provider workflows or recovery from a destructive migration.

## Scope and verified baseline

Canonical repository: `blendproperty/stor24-portal`, branch `main`, fetched revision `bc47f71f55b747e7fa754e3a444814ba860eda5d`. Work is isolated in `codex/production-readiness-20261004`; the older CRM checkout and unrelated changes are preserved. Public website, CMS, BlendSign and physical-access services are dependencies, not silently included as modified repositories.

Read-only SSH on 4 October confirms `/opt/stor24-crm` at the same main revision, healthy app, 16 GB host memory, disk usage 52%, PostgreSQL maximum 100 connections and no app CPU/memory/PID bounds. Runtime logging was already bounded to three 10 MB files. Encrypted backup completed `2026-10-04T07:22:02Z`, timer active, explicitly `offSite: false`. Prior isolated restore record: `2026-10-01T04:40:46Z`, 75 tables, two seconds, no production database modification. These are baseline observations, not proof of this candidate's deployment.

The supplied Project Engineering and Readiness Standard is the requirements baseline. The hardening guide supplies assessment topics; illustrative traffic targets and advice do not prove defects or authorize customer transactions.

## Critical workflow trace

Public reservation input enters the restricted public API, is validated and rate limited, and passes facility/unit/availability checks in `public-booking-service.ts`. Reservation and package state are persisted transactionally; communication occurs across an external provider boundary. Payment acceptance must come from verified provider evidence, with durable replay handling and payment/ledger reconciliation. Move-in requires operational readiness and must not accept training receipts as real payment. Physical access requires separately confirmed provider completion. Failure, uncertainty, late callback, replay and reconciliation must remain visible throughout this chain.

Existing isolated CI covers staff/customer/facility boundaries, recovery-code concurrency, receipt replay, stock concurrency, provider message claims, move-in training separation, finance services and synthetic restoration. CI fixtures and simulations remain separate from physical-device, customer and provider acceptance.

## Engineering changes in this candidate

- Per-process PostgreSQL pool: 10 connections, five-second connection/queue acquisition timeout, 30-second idle pool timeout, 30-second statement deadline and 60-second idle transaction deadline. Validated overrides have hard ceilings; URL parameters cannot disable these settings. TLS parameters are preserved. Limits apply to the application adapter, not migrations or every provider's own database.
- Container limits: app two CPUs/2 GB/256 PIDs; migration one CPU/1 GB/256 PIDs; PostgreSQL two CPUs/2 GB/256 PIDs. Three 10 MB log files per service. App and migrator limits take effect on normal release; PostgreSQL configuration requires a separately planned recreation and verification, since the normal deployment intentionally updates only the app.
- Release checks: mainline now runs isolated transaction/restore validation. Both automatic and manual deployment require CI, security and isolated transaction/restore success on the exact current main SHA. Failed, missing, unfinished, older or PR-only results cannot authorize deployment. A moving main fails closed.
- Ten-minute monitor adds disk, available host memory, database connection pressure, app health and OOM checks. Failures produce failed GitHub runs; delivery to a named on-call responder still requires acceptance.
- Monthly restore workflow invokes the existing encrypted-backup restore into a disposable network-isolated database. No production customer records or provider effects are generated.
- Isolated database read-pressure probe covers 10/25/50 concurrent readers, records p95 latency and connections, and rejects errors or excessive queue delays. This is not a business-workflow peak load certification.

## Acceptance register

| Area | Evidence / remaining gate | Accountable role and next action |
|---|---|---|
| Permissions | Existing unit, browser and isolated database boundaries; candidate CI must pass | Engineering: retain route/resource/organisation/facility checks; staff/customer UAT owner to be named |
| Integrity and retries | Existing database concurrency/replay suites; new timeout and read-queue tests | Engineering: exact-head CI; finance owner: provider-to-ledger reconciliation |
| Recovery | Daily encrypted local backup, prior isolated DB restore; no independent custody/off-server copy | Infrastructure/business owner: approve destination, credentials, independent key recovery, retention, RPO/RTO and host-loss rehearsal |
| Backup coverage | Database archive only; external signed documents/files/configuration/provider retention need inventory and restoration evidence | Infrastructure/provider owners: prove complete document, configuration, DNS and secret recovery |
| Capacity | Bounded application connections/resources; isolated read-queue probe | Engineering/business: supply expected workload, representative isolated booking/report/payment/provider-failure load, resource and cost thresholds |
| Monitoring | App/DB/backup and new host thresholds; GitHub failure signal | Operations: name responder, verify delivered alert and run incident drill; CPU/slow-query/provider delivery monitoring remains to be validated |
| Releases | Exact-main gate; backup before migration; previous images | Engineering: passing source/release checks, deployed SHA and runtime configuration; rehearse rollback with compatible schema |
| Environment separation | Isolated CI/browser fixtures and persistent private technical staging; independent keys/DB, no egress or published ports | Infrastructure/business: representative synthetic data, authenticated workflow UAT and approved access/provider sandbox method remain open |
| Payments/MRI | Implemented service/replay controls are not settlement or posting acceptance | Finance/provider owners: settlement, reconciliation, exception ownership and approved production policies |
| Identity/access | Consent/scoped storage and move-in gates; device effects distinct | Legal/access owner: approved retention and physical enrolment/entry/revocation UAT |
| Data/merchandise/insurance | Existing configuration and workflow gates persist | Business: verified stock, prices/VAT, insurance terms and authorized migration data |
| People and launch | Existing UAT/training pack; no new sign-off asserted | Brett/appointed launch owner: staff training, named UAT, legal/privacy and go/no-go acceptance |

Owners above are responsible roles, not claims of a person's acceptance. Full launch remains blocked until applicable gates have named owners and dated evidence. No real charge, receipt, customer message, identity capture or physical-access test is authorized as simulated validation.

## Release and recovery procedure

1. Pass exact-source PR CI/security/transaction suites. Merge through branch protection; mainline suites must also pass before production deployment.
2. Use the normal production workflow, which verifies current main SHA, creates an encrypted pre-migration backup and applies reviewed versioned migrations. This candidate contains no schema migration.
3. Verify deployed SHA/image, health, app cgroup limits/log policy, actual PostgreSQL session deadlines and scheduled monitor outcome. Explicitly distinguish unapplied database container limits.
4. On regression, retain the failed release evidence, select the last validated compatible revision/image and restore its app/configuration through an authorized controlled rollback. Do not use emergency schema resets; database rollback requires reviewed migration/restore and data reconciliation. A rollback of this deployment gate itself requires a reviewed forward change, because older arbitrary SHAs intentionally fail the gate.
5. Restore the latest encrypted archive only using `scripts/dlp-restore-proof.sh` into its disposable network-isolated target. Record timestamp, usability checks and recovery duration separately from encryption/archive listing. Off-server/host-loss recovery remains unproven.

## Technical references

Configuration semantics checked against [node-postgres client documentation](https://node-postgres.com/apis/client), [PostgreSQL session timeouts](https://www.postgresql.org/docs/17/runtime-config-client.html) and [Docker Compose service limits](https://docs.docker.com/reference/compose-file/services/).
