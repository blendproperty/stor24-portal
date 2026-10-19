#!/usr/bin/env bash
set -euo pipefail
umask 077
# Retain the private encrypted fixture and proof for review; never touch source data.
test_dir=$(mktemp -d /opt/stor24-backup-cloud/test-transport.XXXXXX)
export RCLONE_DESTINATION=":local:$test_dir/copy"
export STOR24_CLOUD_STATUS_DIR="$test_dir/status"
bash /opt/stor24-backup-cloud/upload.sh
before=$(sha256sum "$test_dir/status/last-success.json")
python3 - "$test_dir" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()
name=json.loads((root/'status/last-success.json').read_text())['archive']
p=root/'copy'/name
assert p.resolve().is_relative_to(root/'copy') and p.is_file()
with p.open('r+b') as f:
    b=f.read(1)
    f.seek(0)
    f.write(bytes([b[0]^1]))
PY
if bash /opt/stor24-backup-cloud/upload.sh; then
  echo 'ERROR: corrupted roundtrip was accepted' >&2
  exit 1
fi
test "$(sha256sum "$test_dir/status/last-success.json")" = "$before"
grep -q '"status":"failed"' "$test_dir/status/last-attempt.json"
echo 'PASS: roundtrip verified; same-size corruption rejected; last success preserved'
