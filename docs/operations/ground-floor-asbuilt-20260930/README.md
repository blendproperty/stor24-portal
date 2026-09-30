# Midpoint ground-floor as-built areas — 30 September 2026

## Source and matching

Brett supplied `MIDPOINT_STAND 11_REVA_GROUND FLOOR ARRANGEMENT PLAN_ASBUILT.pdf` and requested ground-floor square metres be corrected, explicitly excluding the second picture (outdoor units 530–532, each 29.6 m²). Drawing B24-001-11A / C-104-00, revision A, dated 29 September 2026. Source SHA-256: `f2edd3d319ddd0047af92b2a453676964d587a643382956cb962f8296b443eb7`.

The one-page drawing labels categories rather than CRM unit numbers. All 139 internal spaces were reconciled to the existing ground-floor map by their wall, corridor and door sequence. A coordinate transformation assisted matching but was manually corrected where the schematic map's proportions differ. Existing unit 46 is absent from the inventory and was not created. Two F / 9 m² labels occur in the same space (unit 62), with no separating wall; these are counted once. Visible corrections supersede underlying text: MEGA 7 / unit 114 is 49 m², and the bottom-left corner / unit 140 is 8 m². The four bottom wing spaces, left to right, are units 140 / 8 m², 139 / 11 m², 138 / 15 m² and 137 / 14 m².

`areas.csv` records all 139 matches, including the 65 already-correct areas. Internal area total changes from 2,016 to 2,042 m². The three excluded outdoor units add 88.8 m² and remain unchanged.

## Implementation and recovery

This is a scoped production inventory correction, not an application release. Area is stored on shared UnitType records. To avoid changing other units or floors, 42 dedicated GF category/area types were inserted and the 74 affected units reassigned. All 69 existing type records remain identical. New types have authoritative areas and null width/length; dimensions were not inferred from area or copied from mismatched types. No unit IDs, numbers, floors, statuses, rates, taxes, map geometry, reservations or occupancies were changed. No rate recalculation or customer transaction was run.

Protected VPS directory `/root/stor24-asbuilt-20260930` holds the pre-change PostgreSQL custom-format dump, readable backup manifest, inventory snapshots, exact dry-run/apply SQL, and scoped rollback SQL. The dump's catalogue was successfully read by pg_restore before applying. The transaction locks the inventory/map tables, checks reviewed inventory against the snapshot, validates target scope and original areas, updates exactly 74 units, checks all 139 results, checks unchanged protected fields, existing types, maps and elements, and compares reservation/occupancy hashes. A single audit event records the source, user authorization, and before/after mapping. Actor is null because this was an operator database maintenance action, not an impersonated application session.

The exact transaction first passed with ROLLBACK, then passed with COMMIT. Recovery must use the protected scoped rollback with its current-type preconditions; do not restore the whole database over intervening business activity. Dedicated types are retained on rollback for traceability.

## Verification and release state

Fresh production readback at 2026-09-30T10:37:53Z verified all 139 areas, all 530 unit IDs/numbers/rates/status/tax fields, unchanged 388 upper-floor and three outdoor records, all 69 existing types, three maps and 1,240 elements. Within the transaction, reservation and occupancy hashes were unchanged. `verification.json` records counts and the audit ID. Strict HTTPS health returned service/database ok at 10:37:54Z. No application build, restart, deployment or configuration change was required; deployed source remains 5f597570ae225ff525c683ee354fce6a4461a3ea.

Authenticated visual verification is pending portal sign-in. Database validation is complete; this does not claim staff visual acceptance, survey certification, revised lease acceptance or full operational UAT. Existing provider, data, finance, legal/privacy, training, recovery and approval gates remain open. No project tracker acceptance was changed.

Commit/push and protected-branch merge of this evidence are tracked in PROJECT_CONTEXT.md; application deployment is not part of this data correction.
