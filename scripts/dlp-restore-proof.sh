#!/usr/bin/env bash
set -euo pipefail
umask 077
archive=${1:?Pass the exact encrypted archive path}
case "$archive" in /opt/backups/stor24-dlp/stor24-*.dump.gpg) ;; *) echo 'Unexpected archive path' >&2; exit 1;; esac
test ! -L "$archive" && test -f "$archive" && test -f "$archive.sha256"
sha256sum --check "$archive.sha256" >/dev/null
target=stor24-dlp-restore-$(date -u +%Y%m%dT%H%M%S)-$$
case "$target" in stor24-dlp-restore-*) ;; *) exit 1;; esac
cleanup() { docker rm -f -- "$target" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Isolated disposable target: no network, ports, host data mounts or original DB writes.
docker run -d --name "$target" --network none --tmpfs /var/lib/postgresql/data:rw,size=1024m --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
for attempt in $(seq 1 40); do docker exec "$target" pg_isready --username=postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$target" pg_isready --username=postgres >/dev/null
docker exec "$target" createdb --username=postgres stor24_restore_proof
started=$(date +%s)
gpg --batch --pinentry-mode loopback --no-symkey-cache --passphrase-file /root/.config/stor24-dlp/backup.passphrase --decrypt "$archive" 2>/dev/null |
  docker exec -i "$target" pg_restore --username=postgres --dbname=stor24_restore_proof --exit-on-error --no-owner --no-privileges
tables=$(docker exec "$target" psql --username=postgres --dbname=stor24_restore_proof --tuples-only --no-align --command="SELECT count(*) FROM pg_tables WHERE schemaname='public';")
test "$tables" -gt 50
for relation in Organisation User Customer Account LedgerEntry Document AuditEvent; do
  docker exec "$target" psql --username=postgres --dbname=stor24_restore_proof --tuples-only --no-align --command="SELECT count(*) FROM \"$relation\";" >/dev/null
done
printf '{"status":"restored","verifiedAt":"%s","tables":%s,"elapsedSeconds":%s,"targetNetwork":"none","productionDatabaseModified":false}\n' "$(date -u +%FT%TZ)" "$tables" "$(( $(date +%s) - started ))" > /opt/backups/stor24-dlp/status/restore-proof.json.tmp
chmod 644 /opt/backups/stor24-dlp/status/restore-proof.json.tmp
mv -- /opt/backups/stor24-dlp/status/restore-proof.json.tmp /opt/backups/stor24-dlp/status/restore-proof.json
cat /opt/backups/stor24-dlp/status/restore-proof.json
