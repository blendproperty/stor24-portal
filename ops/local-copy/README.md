# STOR24 encrypted archive copy to OneDrive

> Superseded on 19 October 2026: the Windows task is disabled. Direct
> Hostinger-to-OneDrive upload is active and cloud-roundtrip restoration passed;
> see [the direct uploader runbook](../onedrive/README.md). Historical PC task
> and desktop sync observations below are retained as evidence.

Status on 19 October 2026: **partial delivery**. The Windows archive task passes;
today's encrypted database archive and checksum were independently uploaded and
seen as Private in OneDrive's web interface. A later cloud download matched the
source checksum and restored successfully to 91 tables in a disposable,
network-isolated PostgreSQL container on Hostinger. Automatic desktop-to-cloud
sync has not passed the fresh-file test. NocoDB and independent recovery-key/
host-loss recovery remain open; the successful restore used the source-host key.

## Installed behavior

- `Copy-Archive.ps1` reads the newest immutable encrypted archive already produced
  by the existing Hostinger backup job. It does not create a second database dump
  or modify production. SSH uses the existing local deployment key and strict host
  checking; no new credentials or permissions were granted.
- It rejects unexpected filenames, hashes and backups older than 30 hours,
  downloads to a private partial file, checks SHA-256 against the source, retains
  dated archives and refuses to replace a conflicting existing archive.
- Only encrypted `.dump.gpg` files and their `.sha256` checksums go in
  `OneDrive - Blend Property Management/STOR24 Backups/Database`.
- Local scripts, configuration, lock, task log and success/attempt evidence are
  under `%LOCALAPPDATA%/STOR24Backup`, with access limited to the current Windows
  user and SYSTEM. No production passphrase was exported.
- The Task Scheduler job `STOR24 encrypted backup to OneDrive` runs at **03:20
  SAST daily**, wakes the PC where supported, starts missed runs when available,
  and retries failures three times at 15-minute intervals. It requires a signed-in
  Windows session, AC power and internet. OneDrive must be signed in and syncing
  for automatic cloud delivery. Sleep/wake and a real overnight run are untested.
- Task exit zero means a source-matching encrypted file reached the local
  OneDrive folder. `cloudUploadVerified:false` is intentional: the archive task
   cannot verify cloud upload. See separate browser evidence for today's manual
   upload and the later cloud-roundtrip restore evidence. The job itself does
   not test restoration or cloud delivery.
- The installer embeds the pinned archive script/configuration in the task so
  the scheduled user's process materializes its own runtime. Early tests could
  not see the installer-created directory and failed; those runs are not passes.

## Install or update

Run `Install-ArchiveTask.ps1` with the existing approved `-Source user@host`,
`-SshKey` path and `-OneDriveRoot`. Do not put private key contents, passphrases,
database credentials, or customer data in Git. Re-run this installer after a
reviewed script change; editing the local runtime alone does not update the
embedded scheduled action. Installing over the same task name updates that task.

Check the installed task and `archive-success.json`, `archive-attempt.json` and
`task.log`. A failed attempt preserves the last successful evidence and archives.
To stop this job, disable that exact task in Task Scheduler; source backups and
previous copied archives remain unchanged.

## Remaining work

1. Resolve unattended desktop OneDrive synchronization and verify a real nightly
   run. A fresh local `sync-verification-20261019.txt` marker was created by the
   scheduled user's process at 06:40:13Z, without a browser upload. It did not
   appear in the cloud during the initial observation; the checksum sidecar
   also retained its manual-upload timestamp despite the 08:40 SAST task run.
   Today's archive cloud upload was performed through the browser. Do not mark
   source backup status `offSite:true` from this partial setup.
2. Provide sufficient local disk space (only about 4.6 GB free during preflight).
   OneDrive can hold encrypted archives; PostgreSQL and NocoDB working storage
   must remain on a local disk outside the synced folder. No NocoDB image was
   downloaded or service installed. A spare office PC is another free-hosting
   destination if this PC cannot provide space or reliable nightly availability.
3. Install the free NocoDB Community viewer over a separate local PostgreSQL copy,
   bind the UI only to localhost, and grant database-level read-only access to
   explicitly selected business data. Application permissions do not carry over;
   keep authentication/session/provider secrets and sensitive raw documents out
   of the viewer. Do not connect NocoDB to production or sync a live database
   directory through OneDrive.
4. The cloud-roundtrip restore passed at 06:41:40Z on 19 October: 91 tables,
   exit-on-error restoration, core relation reads, networking disabled, no
   production database modification, and temporary container removed. The exact
   cloud-downloaded bytes were uploaded to a separate encrypted verification
   directory on Hostinger and restored using the existing reviewed procedure.
   This supersedes the earlier blocked combined export/restore/cleanup attempt
   for this bounded test only. No key export or local/off-host restore occurred.
   Local viewer permissions and refresh-failure tests still need doing.
5. Establish approved independent recovery-key custody: the decryption passphrase
   remains on Hostinger. Loss of that key would make cloud archives unusable.
   Database snapshots also do not establish recovery of external documents,
   uploaded objects, environment configuration or the complete application.

No new hosting bill, production deployment, merge, provider activation, customer
mutation, broader staff access, or full disaster-recovery acceptance is implied.
