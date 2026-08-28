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

## Validate before any import

Run:

```powershell
npm run migration:validate -- "C:\approved\stor24-export" "C:\approved\stor24-export\validation.json"
```

The command fails on missing files or columns, duplicate legacy identifiers and broken facility, unit-type, unit or customer references. Retain `validation.json` as rehearsal evidence.

## Rehearsal gates

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

- Announce a legacy-system data freeze with a named owner and timestamp.
- Take a fresh full export after the freeze; do not reuse rehearsal data.
- Validate and reconcile before switching users to STOR24.
- Retain the pre-import database backup and the original export in encrypted storage.
- Roll back if counts do not reconcile, duplicate occupancy exists, authentication fails, or a critical booking/move-in workflow fails.
- After acceptance, record the final source timestamp, import revision, database backup, row counts, exceptions and named sign-off in Asana.

## Current blocker

The validator and canonical contracts are ready. A rehearsal cannot be claimed until an authorised legacy export is supplied and the count/referential checks are executed against it.
