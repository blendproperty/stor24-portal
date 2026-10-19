#!/usr/bin/env bash
set -euo pipefail
umask 077
remote=${RCLONE_DESTINATION:?Configure the authorised OneDrive destination}
state=${STOR24_CLOUD_STATUS_DIR:-/opt/stor24-backup-cloud/status}
install -d -m 700 "$state"
exec 9>"$state/upload.lock"
flock -n 9 || exit 0
trap 'printf "{\"status\":\"failed\",\"checkedAt\":\"%s\"}\n" "$(date -u +%FT%TZ)" > "$state/last-attempt.json"' ERR
bash /opt/stor24-crm/scripts/dlp-backup-health.sh >/dev/null
shopt -s nullglob
archives=(/opt/backups/stor24-dlp/stor24-????????T??????Z.dump.gpg)
test "${#archives[@]}" -gt 0
archive=${archives[-1]}
name=$(basename "$archive")
[[ "$name" =~ ^stor24-[0-9]{8}T[0-9]{6}Z\.dump\.gpg$ ]]
test ! -L "$archive"
sha256sum --check "$archive.sha256" >/dev/null
expected=$(sha256sum "$archive")
expected=${expected%% *}
# Immutable dated copies; always read the uploaded bytes back before success.
rclone copyto "$archive" "$remote/$name" --size-only --immutable --retries 3
received=$(rclone cat "$remote/$name" --retries 3 | sha256sum)
test "${received%% *}" = "$expected"
printf '%s  %s\r\n' "$expected" "$name" > "$state/checksum.sha256"
rclone copyto "$state/checksum.sha256" "$remote/$name.sha256" --ignore-existing --retries 3
sidecar=$(rclone cat "$remote/$name.sha256" --retries 3)
test "${sidecar%% *}" = "$expected"
printf '{"status":"uploaded-and-readback-verified","checkedAt":"%s","archive":"%s","sha256":"%s"}\n' "$(date -u +%FT%TZ)" "$name" "$expected" > "$state/last-success.json.tmp"
mv -- "$state/last-success.json.tmp" "$state/last-success.json"
cp -- "$state/last-success.json" "$state/last-attempt.json"
cat "$state/last-success.json"
