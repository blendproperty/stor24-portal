#!/usr/bin/env bash
# Read-only checks: never post provider callbacks or create customer records.
set -euo pipefail

origin_ip=93.127.186.194
for hostname in stor24.co.za www.stor24.co.za portal.stor24.co.za cms.stor24.co.za; do
  for probe in plain forged; do
    # Bash 3.2 treats an empty array as unset under nounset; expand only when set.
    extra_headers=()
    if [[ "$probe" == forged ]]; then
      extra_headers=(-H 'X-Forwarded-For: 173.245.48.1' -H 'CF-Connecting-IP: 173.245.48.1' -H 'X-Real-IP: 173.245.48.1')
    fi
    for attempt in 1 2 3; do
      if status="$(curl --silent --show-error --noproxy '*' --max-time 12 --connect-timeout 8 \
        --resolve "$hostname:443:$origin_ip" \
        -A 'stor24-origin-monitor/1.1 (+github-actions)' \
        ${extra_headers[@]+"${extra_headers[@]}"} --output /dev/null --write-out '%{http_code}' \
        "https://$hostname/api/health")"; then
        if [[ "$status" != 403 ]]; then
          echo "STOR24_ORIGIN_FAILED host=$hostname probe=$probe http=$status" >&2
          exit 1
        fi
        break
      else
        code=$?
        # Retry transport failures only; an HTTP response must never be hidden by a retry.
        if [[ "$attempt" == 3 || ! "$code" =~ ^(7|28|35|52|56)$ ]]; then
          echo "STOR24_ORIGIN_UNVERIFIED host=$hostname probe=$probe curl=$code attempts=$attempt" >&2
          exit "$code"
        fi
        sleep 2
      fi
    done
  done
done
echo 'All four STOR24 origins deny direct and forged-header access'
