#!/usr/bin/env bash
# Run as root on the established STOR24 VPS after this release is deployed.
# This configures deletion only. It never enables photo collection or provider writes.
set -euo pipefail
test "$(id -u)" = 0
cd /opt/stor24-crm
test -f .env
test -f compose.prod.yml
test -f scripts/run-facial-photo-worker.sh
umask 077
install -d -m 700 /etc/stor24
credential_file=/etc/stor24/facial-photo-worker.env
if ! test -f "$credential_file"; then
  printf 'FACIAL_PHOTO_CRON_KEY=%s\n' "$(openssl rand -hex 32)" > "$credential_file"
fi
chmod 600 "$credential_file"
source "$credential_file"
test "${#FACIAL_PHOTO_CRON_KEY}" = 64
digest=$(printf '%s' "$FACIAL_PHOTO_CRON_KEY" | sha256sum | cut -d' ' -f1)
env_tmp=$(mktemp .env.facial-photo.XXXXXX)
grep -v '^FACIAL_PHOTO_CRON_SECRET_SHA256=' .env > "$env_tmp" || true
printf 'FACIAL_PHOTO_CRON_SECRET_SHA256=%s\n' "$digest" >> "$env_tmp"
chmod 600 "$env_tmp"
mv "$env_tmp" .env
cat > /etc/systemd/system/stor24-facial-photo-expiry.service <<'SERVICE'
[Unit]
Description=Remove expired STOR24 private photographs
After=docker.service
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/stor24-crm/scripts/run-facial-photo-worker.sh
TimeoutStartSec=180
SERVICE
cat > /etc/systemd/system/stor24-facial-photo-expiry.timer <<'TIMER'
[Unit]
Description=Check STOR24 private photo retention every five minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
TIMER
container=$(docker compose --env-file .env -f compose.prod.yml ps -q app)
current_image=$(docker inspect --format '{{.Config.Image}}' "$container")
image_tag=${current_image##*:}
IMAGE_TAG="$image_tag" docker compose --env-file .env -f compose.prod.yml up -d --no-deps --force-recreate app
systemctl daemon-reload
systemctl enable --now stor24-facial-photo-expiry.timer
echo 'Retention timer installed. Verify the first successful run; photo collection remains separately gated.'
