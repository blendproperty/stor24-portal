#!/usr/bin/env bash
set -euo pipefail

response=$(mktemp)
trap 'rm -f "$response"' EXIT
# curl can rewind a regular file on retry; captured stdout concatenates partial bodies.
if curl --fail --silent --show-error --max-time 35 --connect-timeout 10 --retry 3 --retry-delay 5 --retry-all-errors \
  -A 'stor24-production-monitor/1.2 (+github-actions)' --output "$response" "$HEALTH_URL"; then
  node -e '
    const fs = require("node:fs");
    let value;
    try { value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { console.error("STOR24_PUBLIC_FAILED check=json"); process.exit(1); }
    const failed = [];
    if (value?.service !== "stor24-crm") failed.push("service");
    if (value?.status !== "ok") failed.push("application");
    if (value?.database !== "ok") failed.push("database");
    if (process.env.EXPECT_MERCHANDISE_WORKER === "true" &&
        (value?.merchandiseExpiry?.enabled !== true || value?.merchandiseExpiry?.status !== "ok")) failed.push("expiry-worker");
    for (const check of failed) console.error(`STOR24_PUBLIC_FAILED check=${check}`);
    if (failed.length) process.exit(1);
  ' "$response"
else
  code=$?
  echo "STOR24_PUBLIC_UNAVAILABLE curl=$code" >&2
  exit "$code"
fi
