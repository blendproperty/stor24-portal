# STOR24 VPS deployment and recovery

Reviewed 4 October 2026. Canonical repository: `https://github.com/blendproperty/stor24-portal.git`, branch `main`. See `PROJECT_CONTEXT.md` and `PRODUCTION_READINESS_2026-10-04.md` for dated release evidence and outstanding acceptance gates.

## Configuration and exposure

Production runs at `/opt/stor24-crm`. Keep `.env` root-restricted (mode 600), outside Git and image build context. Required application values include `DATABASE_URL`, `AUTH_SECRET`, `APP_URL=https://portal.stor24.co.za` and the reviewed database credentials. Preserve separately configured provider keys and gates; do not enable providers as part of an application release.

The unprivileged standalone app binds through Docker to host loopback port 3014. Traefik supplies the public HTTPS route. PostgreSQL has no public port. The application pool defaults to 10 connections, acquisition deadline 5 seconds, statement deadline 30 seconds and idle-transaction deadline 60 seconds per process. `DB_*` overrides are bounded and validated. Review aggregate process/worker connections against the database maximum; these are not migration timeouts.

`compose.prod.yml` bounds app and database resources to two CPUs/2GB/256 PIDs, migrator to one CPU/1GB/256 PIDs, and each service's logs to three 10 MB files. Normal deployment updates only the app, so applying database container configuration requires an explicitly recorded runtime update or planned recreation and verification.

## Controlled update

`Deploy to VPS` runs after successful mainline CI and also supports manual dispatch. Both paths require exact-current-main successful CI, security and isolated transaction/restore runs through `scripts/verify-release.mjs`. Arbitrary branch names, old SHAs, missing/failed/unfinished checks and a moving main fail closed. The workflow needs repository/production-environment secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`; values must never be printed.

The workflow fetches the verified immutable SHA, creates an encrypted pre-migration backup, builds tagged app/migrator images, applies reviewed versioned migrations, recreates only the app and verifies health. It also installs/enables the daily encrypted-backup timer. A successful build is not deployment or business UAT evidence. Record actual image/revision/configuration and live outcome separately.

For new installations, use a dedicated empty database and the reviewed versioned migration/empty-bootstrap procedure. Historical migration ordering is handled by `scripts/bootstrap-empty-database.mjs`, which requires explicit opt-in and refuses populated schemas. Never use this bootstrap, schema reset or database push to repair an existing production database.

## Verification

Check public HTTPS `/api/health` for service/database readiness, image tag/digest and container health, actual CPU/memory/PID/log configuration, application database connection/session settings, the scheduled production monitor, anonymous route denial and applicable authenticated workflow UAT. Preserve provider and financial acceptance gates. The ten-minute monitor checks health, encrypted-backup freshness, host disk/memory, database connections and app OOM. A failed GitHub run is a signal; a named responder and demonstrated alert delivery remain required.

## Recovery and rollback

Encrypted daily database archives and status live under `/opt/backups/stor24-dlp`; the current passphrase is server-local. Archive checks and local restoration do not prove off-server recovery, independent key custody or complete document/configuration recovery. Retention, RPO/RTO and host-loss recovery require owner acceptance.

Use `scripts/dlp-restore-proof.sh` with the exact encrypted archive path for a disposable network-isolated restore. The monthly `Isolated production backup restore` workflow invokes this procedure; it never restores over the original database. Retain its dated proof independently of backup encryption/freshness.

For an application regression, identify the previous validated retained image and prove schema/configuration compatibility first. Retain the current candidate tag, then select the compatible previous tag with `IMAGE_TAG=<validated-previous-tag> docker compose --env-file .env -f compose.prod.yml up -d --no-deps app`. Verify container and HTTPS health and the affected workflow. Do not run migrations backwards automatically or change provider gates. A schema-incompatible regression requires reviewed recovery, backup restoration and data/provider reconciliation, rather than this app-only image switch.

The deployment workflow intentionally rejects old SHAs; controlled compatible-image rollback is a separate operational recovery action. The 4 October image-switch rehearsal ran only in private staging and does not prove production financial/provider rollback. Keep previous images/configuration and record any actual production recovery separately.

## Private technical staging

`/opt/stor24-staging` uses `compose.staging.yml`, separate random credentials, a persistent synthetic-only database and an internal network with no published ports or provider credentials. Inspect health from inside `stor24-readiness-staging-app-1`; no public staging URL is configured. Do not copy production data or environment files. Authenticated representative synthetic workflow and provider-sandbox UAT remain separate gates.
