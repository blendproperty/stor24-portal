# STOR24 encrypted archive copy to OneDrive

Status on 19 October 2026: **partial delivery**. The Windows archive task passes;
today's encrypted database archive and checksum were independently uploaded and
seen as Private in OneDrive's web interface. Automatic desktop-to-cloud sync,
NocoDB, isolated restoration and independent recovery-key custody are still open.

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
  upload. Do not equate either with a successful restore.
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

1. Verify unattended desktop OneDrive synchronization and a real nightly run;
   today's cloud upload was performed through the browser. Do not mark source
   backup status `offSite:true` from this partial setup.
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
4. Perform and record an isolated restore and viewer permissions/refresh-failure
   tests. Automatic approval review rejected the attempted passphrase-export and
   restore/cleanup commands with only `blocked by policy`; no local decryption or
   restore executed. Unverified restore drafts are not delivered source.
5. Establish approved independent recovery-key custody: the decryption passphrase
   remains on Hostinger. Loss of that key would make cloud archives unusable.
   Database snapshots also do not establish recovery of external documents,
   uploaded objects, environment configuration or the complete application.

No new hosting bill, production deployment, merge, provider activation, customer
mutation, broader staff access, or full disaster-recovery acceptance is implied.
