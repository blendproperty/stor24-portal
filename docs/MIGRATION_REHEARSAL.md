# STOR24 legacy migration rehearsal

This runbook covers operational records only. Financial history, payment-provider data and Hikvision credentials are excluded from this accelerated operational release.

## Required source package

Copy the six legacy extracts into a new, access-controlled directory using the exact filenames and headers in `migration/templates`:

- `facilities.csv`
- `unit_types.csv`
- `units.csv`
- `customers.csv`
- `tenancies.csv`
- `reservations.csv`

Do not commit populated extracts. They contain customer information.

Choose a separate JSON report path. The validator rejects source-file output paths and existing aliases that resolve to a source file, including hard links, before truncating any report. Normal existing report files may be refreshed. Keep source exports in an access-controlled directory; this guard does not replace filesystem access controls or backups.

## Validate before any import

Run:

```powershell
npm run migration:validate -- "C:\approved\stor24-export" "C:\approved\stor24-export\validation.json"
```

The command fails on missing files or columns, duplicate legacy identifiers, blank required relationships and broken facility, unit-type, unit or customer references. A unit must share its unit type's facility; a tenancy or reservation must share its unit's facility. Optional customer contact fields remain optional. Retain `validation.json` as rehearsal evidence. This read-only validation does not import records, validate financial balances or establish production migration acceptance.

## Rehearsal gates

CSV parsing rejects unclosed or misplaced quotes, text after a closing quote, duplicate/empty headers and rows whose column counts differ from the header. Quoted commas, escaped double quotes and quoted multiline fields are supported. A parse error makes the package invalid; do not interpret an invalid report's counts as a complete export.

1. Record the source-system extraction timestamp in SAST and source row counts.
2. Validate the untouched export. Correct source data or an explicitly versioned transformation; never hand-edit the only copy.
3. Back up PostgreSQL and record the backup filename and SHA-256 digest.
4. Import into a non-production rehearsal database using idempotent legacy-ID mappings.
5. Reconcile record counts by facility and compare every active tenancy to one customer, one account and one active/pending occupancy.
6. Confirm no unit has more than one active occupancy or active reservation.
7. Sample at least ten customers across active tenancy, reservation and no-current-contract states.
8. Run the application validation suite and smoke-test dashboard, tenants, units, reservations, insurance and reports.
9. Record every defect, correct the repeatable transformation, restore a clean rehearsal database and rerun from the original extract.

## Cut-over controls

The validation report fingerprints each readable source file with its exact-byte SHA-256 and size. For a valid package, `reconciliation.byFacility` records source unit-type, unit, tenancy and reservation counts plus distinct linked customers; `customersWithoutContracts` records customers without any source tenancy/reservation. Linked customers may appear at multiple facilities, so do not sum that column as a global customer total. All contract statuses are counted. Compare these counts to the source owner's totals and the later rehearsal database; they are not financial totals or proof of import success. `reconciliation.ready` means source count evidence is available, not launch approval. Invalid packages have null reconciliation counts and remain blocked. Preserve the source extraction timestamp separately; the report generation time is not extraction time.

- Announce a legacy-system data freeze with a named owner and timestamp.
- Take a fresh full export after the freeze; do not reuse rehearsal data.
- Validate and reconcile before switching users to STOR24.
- Retain the pre-import database backup and the original export in encrypted storage.
- Roll back if counts do not reconcile, duplicate occupancy exists, authentication fails, or a critical booking/move-in workflow fails.
- After acceptance, record the final source timestamp, import revision, database backup, row counts, exceptions and named sign-off in Asana.

## Current blocker

The validator and canonical contracts are ready. A rehearsal cannot be claimed until an authorised legacy export is supplied and the count/referential checks are executed against it.
