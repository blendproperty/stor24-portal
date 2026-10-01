#!/usr/bin/env bash
set -euo pipefail
umask 077
archive_dir=/opt/backups/stor24-dlp
key_dir=/root/.config/stor24-dlp
key_file=$key_dir/backup.passphrase
test ! -L "$archive_dir" && test ! -L "$key_dir"
install -d -m 700 "$archive_dir" "$key_dir"
install -d -m 755 "$archive_dir/status"
exec 9>"$archive_dir/backup.lock"
flock -n 9 || exit 0
if test ! -f "$key_file"; then openssl rand -base64 48 > "$key_file"; fi
test ! -L "$key_file" && test -s "$key_file"
chmod 600 "$key_file"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive=$archive_dir/stor24-$stamp.dump.gpg
partial=$archive.partial
trap 'rm -f -- "$partial"' EXIT
docker exec stor24-crm-postgres-1 pg_dump --username=stor24 --dbname=stor24_crm --format=custom --no-owner --no-privileges |
  gpg --batch --yes --pinentry-mode loopback --no-symkey-cache --passphrase-file "$key_file" --symmetric --cipher-algo AES256 --output "$partial"
# Verify integrity and that the decrypted stream is a valid PostgreSQL archive.
gpg --batch --pinentry-mode loopback --no-symkey-cache --passphrase-file "$key_file" --decrypt "$partial" 2>/dev/null |
  docker exec -i stor24-crm-postgres-1 sh -c 'pg_restore --list >/dev/null; result=$?; cat >/dev/null; exit "$result"'
mv -- "$partial" "$archive"
sha256sum "$archive" > "$archive.sha256"
printf '{"status":"verified","completedAt":"%s","encrypted":true,"offSite":false}\n' "$(date -u +%FT%TZ)" > "$archive_dir/status/latest.json.tmp"
chmod 644 "$archive_dir/status/latest.json.tmp"
mv -- "$archive_dir/status/latest.json.tmp" "$archive_dir/status/latest.json"
printf 'Encrypted backup created and archive integrity verified: %s\n' "$(basename "$archive")"
# No deletion of historical backups: retention/off-site policy needs ownership.
