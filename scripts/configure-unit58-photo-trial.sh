#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/stor24-crm
IFS= read -r action
IFS= read -r template
IFS= read -r expected_sha
test "$action" = enable || test "$action" = disable
if test "$action" = enable; then
  [[ "$expected_sha" =~ ^[a-f0-9]{40}$ ]] && test "$(git rev-parse HEAD)" = "$expected_sha"
fi
test -f .env && test ! -L .env
container=$(docker compose --env-file .env -f compose.prod.yml ps -q app)
test -n "$container"
image=$(docker inspect --format '{{.Config.Image}}' "$container")
[[ "$image" == stor24-crm:* ]] || { echo 'Unexpected application image; configuration refused.'; exit 1; }
tag=${image#stor24-crm:}

if test "$action" = enable; then
  hour=$(date -u +%H)
  test "$hour" -ge 5 && test "$hour" -lt 17 || { echo 'Trial can only start during the daylight test window.'; exit 1; }
  organisation_id=$(docker exec stor24-crm-postgres-1 psql -U stor24 -d stor24_crm -At -v ON_ERROR_STOP=1 -c \
    "SELECT f.\"organisationId\" FROM \"Reservation\" r JOIN \"Facility\" f ON f.id=r.\"facilityId\" JOIN \"Organisation\" o ON o.id=f.\"organisationId\" JOIN \"Unit\" u ON u.id=r.\"unitId\" JOIN \"Tenancy\" t ON t.id=r.\"convertedTenancyId\" JOIN \"Document\" d ON d.\"tenancyId\"=t.id WHERE r.id='cmwerdxa2000501qe0lhkr5qw' AND o.slug='stor24' AND u.number='58' AND r.status='CONVERTED' AND t.status='DRAFT' AND d.type='LEASE_AGREEMENT' AND d.provider='BLENDSIGN' AND d.status='SIGNED' AND d.\"signedAt\" IS NOT NULL")
  [[ "$organisation_id" =~ ^[a-z0-9]+$ ]] || { echo 'Signed Unit 58 booking not found; no configuration changed.'; exit 1; }
  ! grep -q '^ADDITIONAL_ACCESS_POLICIES_JSON=' .env || { echo 'An additional-person policy already exists; no configuration changed.'; exit 1; }
  ends=$(date -u +%Y-%m-%dT17:00:00Z)
  policy=${template/__TRIAL_ENDS_AT__/$ends}
  [[ "$policy" == *'"trialReservationId":"cmwerdxa2000501qe0lhkr5qw"'* ]] || exit 1
  line='ADDITIONAL_ACCESS_POLICIES_JSON={"'"$organisation_id"'":'"$policy"'}'
elif grep -q '^ADDITIONAL_ACCESS_POLICIES_JSON=' .env; then
  grep '^ADDITIONAL_ACCESS_POLICIES_JSON=' .env | grep -q '"trialReservationId":"cmwerdxa2000501qe0lhkr5qw"' || { echo 'A different policy is configured; removal refused.'; exit 1; }
else
  echo 'Unit 58 photo trial already disabled.'
  exit 0
fi

tmp=$(mktemp .env.unit58.XXXXXX)
old=$(mktemp .env.unit58.previous.XXXXXX)
trap 'rm -f "$tmp" "$old"' EXIT
cp -p .env "$old"
grep -v '^ADDITIONAL_ACCESS_POLICIES_JSON=' .env > "$tmp" || true
if test "$action" = enable; then printf '%s\n' "$line" >> "$tmp"; fi
chmod 600 "$tmp"
mv "$tmp" .env
if ! IMAGE_TAG="$tag" docker compose --env-file .env -f compose.prod.yml up -d --no-deps --no-build app; then
  mv "$old" .env
  IMAGE_TAG="$tag" docker compose --env-file .env -f compose.prod.yml up -d --no-deps --no-build app
  exit 1
fi
if ! container=$(docker compose --env-file .env -f compose.prod.yml ps -q app) || test -z "$container"; then
  mv "$old" .env
  IMAGE_TAG="$tag" docker compose --env-file .env -f compose.prod.yml up -d --no-deps --no-build app
  exit 1
fi
for attempt in $(seq 1 40); do
  if ! state=$(docker inspect --format '{{.State.Health.Status}}' "$container"); then break; fi
  test "$state" = healthy && break
  if test "$state" = unhealthy; then break; fi
  sleep 2
done
if test "${state:-missing}" != healthy; then
  mv "$old" .env
  IMAGE_TAG="$tag" docker compose --env-file .env -f compose.prod.yml up -d --no-deps --no-build app
  echo 'Trial configuration rolled back after failed health check.'
  exit 1
fi
echo "Unit 58 photo trial $action; app healthy."
