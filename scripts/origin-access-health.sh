#!/usr/bin/env bash
# Read-only checks: never post provider callbacks or create customer records.
set -euo pipefail

origin_ip=93.127.186.194
for hostname in stor24.co.za www.stor24.co.za portal.stor24.co.za cms.stor24.co.za; do
  for probe in plain forged; do
    extra_headers=()
    if [[ "$probe" == forged ]]; then
      extra_headers=(-H 'X-Forwarded-For: 173.245.48.1' -H 'CF-Connecting-IP: 173.245.48.1' -H 'X-Real-IP: 173.245.48.1')
    fi
    status="$(curl --silent --show-error --max-time 20 --connect-timeout 8 \
      --resolve "$hostname:443:$origin_ip" \
      -A 'stor24-origin-monitor/1.0 (+github-actions)' \
      "${extra_headers[@]}" --output /dev/null --write-out '%{http_code}' \
      "https://$hostname/api/health")"
    if [[ "$status" != 403 ]]; then
      echo "Origin protection failed: $hostname ($probe) returned $status; expected 403" >&2
      exit 1
    fi
  done
done
echo 'All four STOR24 origins deny direct and forged-header access'
