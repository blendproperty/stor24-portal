#!/usr/bin/env bash
set -euo pipefail
node <<'NODE'
const fs = require('fs');
const status = JSON.parse(fs.readFileSync('/opt/backups/stor24-dlp/status/latest.json', 'utf8'));
const age = Date.now() - Date.parse(status.completedAt);
if (status.status !== 'verified' || status.encrypted !== true || !Number.isFinite(age) || age < 0 || age > 26 * 3600000) process.exit(1);
console.log('Encrypted backup freshness verified');
NODE
