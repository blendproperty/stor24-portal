# Synthetic database restore evidence

This repeatable CI drill supports CIA-A1. It is not production recovery acceptance, an approved RPO/RTO, a test of backup encryption/key recovery, or proof of provider/device recovery.

The transaction workflow creates a disposable PostgreSQL 16 database containing only synthetic fixtures. After the transaction/security tests, `scripts/test-synthetic-restore.ts`:

1. Requires the isolated GitHub job, exact synthetic source database and disposable PostgreSQL container. It refuses an existing restore target.
2. Captures table counts/content checksums and column, constraint, index, enum and sequence definitions. Representative customers, accounts, ledger entries, documents, audit events and role assignments must be present.
3. Uses PostgreSQL 16 `pg_dump` and `pg_restore` to restore a custom-format backup into a separate database in that disposable container. No production host, backup, secret or customer record is used.
4. Compares all restored snapshots and verifies the original database remains unchanged. Connection, query and external-command deadlines bound the exercise.
5. Removes the disposable target and clears the in-memory backup. Only an aggregate JSON evidence report is retained by GitHub; database dumps and record contents are not published.

The report records the exact commit, aggregate row counts, measured synthetic dump/restore/verification timings, comparison results and limitations. These timings describe this CI fixture, not a business recovery commitment. Application role assignments are compared as data; production database grants, MFA, secret recovery and provider reconnection are outside this drill.

Production acceptance still requires approved recovery/data-loss targets, encrypted off-system backup custody, key recovery, restoration of an actual authorised backup into isolation, consistency and permissions acceptance, reapplication of privacy deletions, measured results, monitoring and named operational sign-off. Messaging, payment and physical access must remain disconnected during that separate exercise.

Implementation and guard tests: 24 September 2026. First real CI restore result and exact promotion evidence are recorded in PROJECT_CONTEXT.md; do not infer success from this procedure alone.
