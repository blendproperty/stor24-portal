#!/usr/bin/env bash
set -euo pipefail
# Keep the reporter independent of application checkouts and container cutovers.
test "$(id -u)" = 0
node --input-type=module <<'NODE'
import { readFileSync, lstatSync } from 'node:fs';
const file = '/etc/stor24-monitor.env';
const stat = lstatSync(file);
if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600 || !/^STOR24_HEARTBEAT_KEY=[a-f0-9]{64}\r?$/m.test(readFileSync(file, 'utf8'))) throw new Error('MONITOR_CONFIGURATION_REQUIRED');
NODE
sha=$(git rev-parse HEAD)
[[ "$sha" =~ ^[a-f0-9]{40}$ ]]
release="/opt/stor24-monitor/releases/$sha"
install -d -m 755 "$release/scripts" "$release/src/lib"
for script in host-heartbeat.mjs host-heartbeat-policy.mjs write-monitor-status.mjs check-host-security.mjs; do
  install -m 644 "scripts/$script" "$release/scripts/$script"
done
install -m 644 src/lib/operations-status-policy.mjs "$release/src/lib/operations-status-policy.mjs"
ln -s "$release" "/opt/stor24-monitor/.current-$$"
mv -Tf "/opt/stor24-monitor/.current-$$" /opt/stor24-monitor/current
install -m 644 docs/stor24-host-heartbeat.service docs/stor24-host-heartbeat.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now stor24-host-heartbeat.timer
systemctl start stor24-host-heartbeat.service
