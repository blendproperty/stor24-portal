# STOR24 production readiness — 4 October 2026

Status: engineering hardening candidate; full production acceptance remains open.

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
| Environment separation | Isolated PostgreSQL CI and browser fixtures | Infrastructure: durable representative staging with isolated provider credentials and data is not verified |
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
