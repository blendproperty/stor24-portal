#!/usr/bin/env bash
set -euo pipefail
# Aggregate operational values only; never print configuration, SQL records or logs.
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
total=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
test "$disk" -lt 85 || { echo 'HOST_DISK_THRESHOLD'; exit 1; }
test "$(( available * 100 / total ))" -gt 10 || { echo 'HOST_MEMORY_THRESHOLD'; exit 1; }
test "$(docker inspect --format '{{.State.Health.Status}}' stor24-crm-app-1)" = healthy
test "$(docker inspect --format '{{.State.OOMKilled}}' stor24-crm-app-1)" = false
connections=$(docker exec stor24-crm-postgres-1 psql -U stor24 -d stor24_crm -Atc "SELECT count(*) FROM pg_stat_activity;")
maximum=$(docker exec stor24-crm-postgres-1 psql -U stor24 -d stor24_crm -Atc 'SHOW max_connections;')
test "$(( connections * 100 / maximum ))" -lt 80 || { echo 'DATABASE_CONNECTION_THRESHOLD'; exit 1; }
printf 'Host disk %s%%; available memory %s%%; database connections %s/%s; app healthy, no OOM\n' "$disk" "$(( available * 100 / total ))" "$connections" "$maximum"
