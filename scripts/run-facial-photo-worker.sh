#!/usr/bin/env bash
set -euo pipefail
source /etc/stor24/facial-photo-worker.env
test "${#FACIAL_PHOTO_CRON_KEY}" = 64
cd /opt/stor24-crm
container=$(docker compose --env-file .env -f compose.prod.yml ps -q app)
binding=$(docker port "$container" 3000/tcp)
case "$binding" in 127.0.0.1:[0-9]*) ;; *) echo 'Unexpected app port binding' >&2; exit 1 ;; esac
# Credential is sent via stdin rather than process arguments or logs.
response=$(printf 'header = "x-cron-key: %s"\n' "$FACIAL_PHOTO_CRON_KEY" | curl --config - --fail --silent --show-error --max-time 40 --connect-timeout 5 --retry 2 --retry-delay 3 --retry-max-time 140 --retry-connrefused --request POST "http://$binding/api/v1/access/photos/expire")
printf '%s' "$response" | python3 -c 'import json,sys; count=json.load(sys.stdin)["data"]["expired"]; assert isinstance(count,int) and 0 <= count <= 100; print("Private photo retention completed; removed:",count)'
