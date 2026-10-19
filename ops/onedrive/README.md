# STOR24 direct OneDrive upload

The active path is **Hostinger encrypted archive -> OneDrive cloud API**.
No PC, desktop sync client or additional VPS is required. The existing daily
encrypted production backup remains the source.

`upload.sh` checks backup health and checksum, copies the latest dated ciphertext
immutably with rclone, reads its cloud bytes back and compares SHA-256, then
checks the cloud checksum sidecar. It does not delete backups or replace
conflicting cloud files. Failure preserves the previous successful proof.
Uploader status is separate from source backup status and restore proof.

## Verified deployment: 19 October 2026

- Ubuntu security-repository rclone `1.60.1+dfsg-3ubuntu0.24.04.6` installed.
  No application/container restart. Helpers live in `/opt/stor24-backup-cloud`.
- Owner explicitly authorized Microsoft consent for the business OneDrive.
  Delegated `Files.ReadWrite offline_access` allows ongoing access to the user's
  OneDrive files; the job's folder limit does not narrow that OAuth grant.
  Tokens stay in root-only `/root/.config/rclone/rclone.conf`, mode 600.
- `/etc/stor24-backup-cloud.env`, mode 600, selects
  `stor24-onedrive:STOR24 Backups/Database`. No secrets belong in Git.
- `stor24-onedrive-upload.timer` is enabled and active: daily **03:20 SAST**
  (01:20 UTC), after the existing 03:00 SAST source backup. Next observed run:
  20 October 2026. Persistent catch-up is enabled. The first overnight run is
  still unobserved. Windows task `STOR24 encrypted backup to OneDrive` is disabled.
- Fresh archive `stor24-20261019T065311Z.dump.gpg` uploaded by the actual systemd
  service and fully read back at 06:53:25Z. SHA-256:
  `3cf2b8884f2ee198b93beba5ffd0437276fc1feec2d33bb1dedba63fc48f4ff1`.
  Browser independently showed the archive and sidecar as Private at 08:53 SAST.
- Downloaded that cloud object into a separate encrypted verification directory
  on Hostinger; SHA-256 matched. Existing reviewed restore procedure restored
  **91 tables** at 06:53:49Z, with exit-on-error and core relation reads, isolated
  networking and tmpfs storage. Temporary container removed; production database
  untouched. Application/database health remained OK at 06:53:50Z.
- `test-transport.sh` passed full-byte verification, same-size corruption
  rejection and preservation of previous success evidence using a local backend.
  Bash syntax and systemd unit verification passed. Actual OneDrive delivery
  above is distinct from this fixture test.

## Operation and remaining gates

Inspect `/opt/stor24-backup-cloud/status/last-attempt.json` and
`last-success.json`, service result/journal, and the timer's next/last trigger.
A successful service run proves cloud readback, not a restore on every night.
Failed uploads leave source archives intact. No cloud deletion/retention policy
or external failure alert is configured. Review account consent/revocation and
storage capacity operationally; never print credential logs or config dumps.

No blanket `offSite:true` or complete host-loss recovery claim follows:
independent decryption-key custody, retention/RPO/RTO ownership, external
files/configuration recovery and application acceptance remain separate.
The restore used Hostinger's existing key; off-host/key-independent recovery
remains open. All wider project/provider/UAT gates remain unchanged.

NocoDB remains uninstalled. A separate PC needs sufficient local disk outside
OneDrive for PostgreSQL and the free Community viewer. Restore into a separate
copy, restrict the viewer's database role to selected business data, test denied
writes, and automate refresh while preserving the last working copy. Validate
viewer access and representative records. Never sync live database files through
OneDrive or connect the viewer to production.
